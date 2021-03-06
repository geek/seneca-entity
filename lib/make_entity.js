'use strict'

var Util = require('util')
var _ = require('lodash')
var Eraro = require('eraro')
var Jsonic = require('jsonic')
var Common = require('./common')

var error = Eraro({
  package: 'seneca',
  msgmap: ERRMSGMAP(),
  override: true
})


var toString_map = {}

function Entity (canon, seneca) {
  var self = this

  self.log$ = function () {
    // use this, as make$ will have changed seneca ref
    this.private$.seneca.log.apply(this, arguments)
  }

  var private$ = self.private$ = function () {}

  private$.seneca = seneca

  private$.canon = canon

  private$.entargs = function (args) {
    args.role = 'entity'
    args.ent = self

    if (this.canon.name !== null) { args.name = this.canon.name }
    if (this.canon.base !== null) { args.base = this.canon.base }
    if (this.canon.zone !== null) { args.zone = this.canon.zone }

    return args
  }

  // use as a quick test to identify Entity objects
  // returns compact string zone/base/name
  self.entity$ = self.canon$()
}

// Properties without '$' suffix are persisted
// id property is special: created if not present when saving
// func$ functions provide persistence operations
// args: (<zone>,<base>,<name>,<props>)
// can be partially specified:
// make$(name)
// make$(base,name)
// make$(zone,base,name)
// make$(zone,base,null)
// make$(zone,null,null)
// props can specify zone$,base$,name$, but args override if present
// escaped names: foo_$ is converted to foo
Entity.prototype.make$ = function () {
  var self = this
  var args = Common.arrayify(arguments)

  var canon, name, base, zone

  // Set seneca instance, if provided as first arg.
  if (args[0] && args[0].seneca) {
    self.private$.seneca = args.shift()
  }

  // Pull out props, if present.
  var argprops = args[args.length - 1]
  var props = {}
  if (argprops && typeof (argprops) === 'object') {
    args.pop()
    props = _.clone(argprops)
  }

  // Normalize args.
  while (args.length < 3) {
    args.unshift(null)
  }

  if (_.isString(props.entity$)) {
    canon = parsecanon(props.entity$)
    zone = canon.zone
    base = canon.base
    name = canon.name
  }
  else if (_.isObject(props.entity$)) {
    canon = {}
    canon.zone = zone = props.entity$.zone
    canon.base = base = props.entity$.base
    canon.name = name = props.entity$.name
  }
  else {
    name = args.pop()
    name = name == null ? props.name$ : name

    canon = parsecanon(name)
  }

  name = canon.name

  base = args.pop()
  base = base == null ? canon.base : base
  base = base == null ? props.base$ : base

  zone = args.pop()
  zone = zone == null ? canon.zone : zone
  zone = zone == null ? props.zone$ : zone

  var new_canon = {}
  new_canon.name = name == null ? self.private$.canon.name : name
  new_canon.base = base == null ? self.private$.canon.base : base
  new_canon.zone = zone == null ? self.private$.canon.zone : zone

  var entity = new Entity(new_canon, self.private$.seneca)
  var canon_str = entity.canon$({string: true})

  for (var p in props) {
    if (props.hasOwnProperty(p)) {
      if (!~p.indexOf('$')) {
        entity[p] = props[p]
      }
      else if (p.length > 2 && p.slice(-2) === '_$') {
        entity[p.slice(0, -2)] = props[p]
      }
    }
  }

  if (props.hasOwnProperty('id$')) {
    entity.id$ = props.id$
  }

  entity.toString = toString_map[canon_str] || toString_map['']
  entity.inspect = entity.toString

  self.log$('make', entity.canon$({string: true}), entity)
  return entity
}

// save one
Entity.prototype.save$ = function (props, cb) {
  var self = this
  var si = self.private$.seneca

  if (_.isFunction(props)) {
    cb = props
  }
  else if (_.isObject(props)) {
    self.data$(props)
  }

  si.act(self.private$.entargs({cmd: 'save'}), cb)
  return self
}

// provide native database driver
Entity.prototype.native$ = function (cb) {
  var self = this
  var si = self.private$.seneca

  si.act(self.private$.entargs({cmd: 'native'}), cb || _.noop)
  return self
}

// load one
// TODO: qin can be an entity, in which case, grab the id and reload
// qin omitted => reload self
Entity.prototype.load$ = function (qin, cb) {
  var self = this
  var si = self.private$.seneca

  var qent = self

  var q = resolve_id_query(qin, self)

  cb = (_.isFunction(qin) ? qin : cb) || _.noop

  // empty query gives empty result
  if (q == null) {
    return cb()
  }

  si.act(self.private$.entargs({ qent: qent, q: q, cmd: 'load' }), cb)

  return self
}

// TODO: need an update$ - does an atomic upsert

// list zero or more
// qin is optional, if omitted, list all
Entity.prototype.list$ = function (qin, cb) {
  var self = this
  var si = self.private$.seneca

  var qent = self
  var q = qin
  if (_.isFunction(qin)) {
    q = {}
    cb = qin
  }

  si.act(self.private$.entargs({qent: qent, q: q, cmd: 'list'}), cb || _.noop)

  return self
}

// remove one or more
// TODO: make qin optional, in which case, use id
Entity.prototype.remove$ = function (qin, cb) {
  var self = this
  var si = self.private$.seneca

  var q = resolve_id_query(qin, self)

  cb = (_.isFunction(qin) ? qin : cb) || _.noop

  // empty query means take no action
  if (q == null) {
    return cb()
  }

  si.act(self.private$.entargs({qent: self, q: q, cmd: 'remove'}), cb || _.noop)

  return self
}
Entity.prototype.delete$ = Entity.prototype.remove$

Entity.prototype.fields$ = function () {
  var self = this

  var fields = []
  for (var p in self) {
    if (self.hasOwnProperty(p) &&
      typeof (self[p]) !== 'function' &&
      p.charAt(p.length - 1) !== '$') {
      fields.push(p)
    }
  }
  return fields
}

/* TODO: is this still needed? */
Entity.prototype.close$ = function (cb) {
  var self = this
  var si = self.private$.seneca

  self.log$('close')
  si.act(self.private$.entargs({cmd: 'close'}), cb || _.noop)
}

Entity.prototype.is$ = function (canonspec) {
  var self = this

  var canon = canonspec
  ? canonspec.entity$ ? canonspec.canon$({object: true}) : parsecanon(canonspec)
  : null

  if (!canon) return false

  return Util.inspect(self.canon$({object: true})) === Util.inspect(canon)
}

Entity.prototype.canon$ = function (opt) {
  var self = this

  var canon = self.private$.canon

  if (opt) {
    if (opt.isa) {
      var isa = parsecanon(opt.isa)

      return _.every(['zone', 'base', 'name'], function (label) {
        return isa[label] === canon[label] || (isa[label] == null && canon[label] == null)
      })
    }
    else if (opt.parse) {
      return parsecanon(opt.parse)
    }
    else if (opt.change) {
        // DEPRECATED
      // change type, undef leaves untouched
      canon.zone = opt.change.zone == null ? canon.zone : opt.change.zone
      canon.base = opt.change.base == null ? canon.base : opt.change.base
      canon.name = opt.change.name == null ? canon.name : opt.change.name

      // explicit nulls delete
      if (opt.zone === null) delete canon.zone
      if (opt.base === null) delete canon.base
      if (opt.name === null) delete canon.name

      self.entity$ = self.canon$()
    }
  }

  return (_.isUndefined(opt) || opt.string || opt.string$)
  ? [ (opt && opt.string$ ? '$' : '') +
    (_.isUndefined(canon.zone) ? '-' : canon.zone),
      _.isUndefined(canon.base) ? '-' : canon.base,
      _.isUndefined(canon.name) ? '-' : canon.name].join('/')
    : opt.array ? [canon.zone, canon.base, canon.name]
      : opt.array$ ? [canon.zone, canon.base, canon.name]
        : opt.object ? {zone: canon.zone, base: canon.base, name: canon.name}
          : opt.object$ ? {zone$: canon.zone, base$: canon.base, name$: canon.name}
            : [canon.zone, canon.base, canon.name]
}

// data = object, or true|undef = include $, false = exclude $
Entity.prototype.data$ = function (data, canonkind) {
  var self = this
  var val

  // TODO: test for entity$ consistent?

  if (_.isObject(data)) {
    // does not remove fields by design!
    for (var f in data) {
      if (f.charAt(0) !== '$' && f.charAt(f.length - 1) !== '$') {
        val = data[f]
        if (_.isObject(val) && val.entity$) {
          self[f] = val.id
        }
        else {
          self[f] = val
        }
      }
    }

    if (data.id$ != null) {
      self.id$ = data.id$
    }

    if (!(_.isNull(data.merge$) || _.isUndefined(data.merge$))) {
      self.merge$ = data.merge$
    }

    return self
  }
  else {
    var include_$ = _.isUndefined(data) ? true : !!data
    data = {}

    if (include_$) {
      canonkind = canonkind || 'object'
      var canonformat = {}
      canonformat[canonkind] = true
      data.entity$ = self.canon$(canonformat)
    }

    var fields = self.fields$()
    for (var fI = 0; fI < fields.length; fI++) {
      if (!~fields[fI].indexOf('$')) {
        val = self[fields[fI]]
        if (_.isObject(val) && val.entity$) {
          data[fields[fI]] = val.id
        }
        else {
          data[fields[fI]] = val
        }
      }
    }

    return data
  }
}

Entity.prototype.clone$ = function () {
  var self = this
  return self.make$(self.data$())
}

function resolve_id_query (qin, ent) {
  var q

  if ((_.isUndefined(qin) || _.isNull(qin) || _.isFunction(qin)) &&
    ent.id != null) {
    q = {id: ent.id}
  }
  else if (_.isString(qin) || _.isNumber(qin)) {
    q = qin === '' ? null : {id: qin}
  }
  else if (_.isFunction(qin)) {
    q = null
  }
  else {
    q = qin
  }

  return q
}

// parse a canon string:
// $zone-base-name
// $, zone, base are optional
function parsecanon (str) {
  var out = {}

  if (_.isArray(str)) {
    return {
      zone: str[0],
      base: str[1],
      name: str[2]
    }
  }

  if (_.isObject(str) && !_.isFunction(str)) return str

  if (!_.isString(str)) return out

  var m = /\$?((\w+|-)\/)?((\w+|-)\/)?(\w+|-)/.exec(str)
  if (m) {
    var zi = m[4] == null ? 4 : 2
    var bi = m[4] == null ? 2 : 4

    out.zone = m[zi] === '-' ? void 0 : m[zi]
    out.base = m[bi] === '-' ? void 0 : m[bi]
    out.name = m[5] === '-' ? void 0 : m[5]
  }
  else throw error('invalid_canon', {str: str})

  return out
}

function ERRMSGMAP () {
  return {
    invalid_canon: 'Invalid entity canon: <%=str%>; expected format: zone/base/name.'
  }
}

function handle_options (entopts) {
  if (entopts.hide) {
    _.each(entopts.hide, function (hidden_fields, canon_in) {
      var canon = parsecanon(canon_in)

      var canon_str = [(canon.zone == null ? '-' : canon.zone),
        canon.base == null ? '-' : canon.base,
        canon.name == null ? '-' : canon.name].join('/')

      toString_map[canon_str] = make_toString(canon_str, hidden_fields)
    })
  }
}

function make_toString (canon_str, hidden_fields_spec) {
  var hidden_fields = [].concat(
    _.isArray(hidden_fields_spec) ? hidden_fields_spec : [])

  if (_.isPlainObject(hidden_fields_spec)) {
    _.each(hidden_fields_spec, function (v, k) {
      hidden_fields.push(k)
    })
  }

  hidden_fields.push('id')

  return function () {
    return ['$',
      canon_str || this.canon$({string: true}),
      ';id=', this.id, ';',
      Jsonic.stringify(this, {omit: hidden_fields || {}})].join('')
  }
}

module.exports = function make_entity (canon, seneca) {
  handle_options(seneca.options().entity || {})
  toString_map[''] = make_toString()

  return new Entity(canon, seneca)
}

module.exports.parsecanon = parsecanon
module.exports.Entity = Entity
