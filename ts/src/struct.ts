/* Copyright (c) 2025 Voxgig Ltd. MIT LICENSE. */

/* Voxgig Struct
 * =============
 *
 * Utility functions to manipulate in-memory JSON-like data
 * structures. These structures assumed to be composed of nested
 * "nodes", where a node is a list or map, and has named or indexed
 * fields.  The general design principle is "by-example". Transform
 * specifications mirror the desired output.  This implementation is
 * designed for porting to multiple language, and to be tolerant of
 * undefined values.
 *
 * Main utilities
 * - getpath: get the value at a key path deep inside an object.
 * - merge: merge multiple nodes, overriding values in earlier nodes.
 * - walk: walk a node tree, applying a function at each node and leaf.
 * - inject: inject values from a data store into a new data structure.
 * - transform: transform a data structure to an example structure.
 * - validate: valiate a data structure against a shape specification.
 *
 * Minor utilities
 * - isnode, islist, ismap, iskey, isfunc: identify value kinds.
 * - isempty: undefined values, or empty nodes.
 * - keysof: sorted list of node keys (ascending).
 * - haskey: true if key value is defined.
 * - clone: create a copy of a JSON-like data structure.
 * - items: list entries of a map or list as [key, value] pairs.
 * - getprop: safely get a property value by key.
 * - setprop: safely set a property value by key.
 * - stringify: human-friendly string version of a value.
 * - escre: escape a regular expresion string.
 * - escurl: escape a url.
 * - joinurl: join parts of a url, merging forward slashes.
 *
 * This set of functions and supporting utilities is designed to work
 * uniformly across many languages, meaning that some code that may be
 * functionally redundant in specific languages is still retained to
 * keep the code human comparable.
 *
 * NOTE: In this code JSON nulls are in general *not* considered the
 * same as the undefined value in the given language. However most
 * JSON parsers do use the undefined value to represent JSON
 * null. This is ambiguous as JSON null is a separate value, not an
 * undefined value. You should convert such values to a special value
 * to represent JSON null, if this ambiguity creates issues
 * (thankfully in most APIs, JSON nulls are not used). For example,
 * the unit tests use the string "__NULL__" where necessary.
 *
 */


// String constants are explicitly defined.

// Mode value for inject step.
const S_MKEYPRE = 'key:pre'
const S_MKEYPOST = 'key:post'
const S_MVAL = 'val'
const S_MKEY = 'key'

// Special keys.
const S_DKEY = '`$KEY`'
const S_DMETA = '`$META`'
const S_DTOP = '$TOP'
const S_DERRS = '$ERRS'

// General strings.
const S_array = 'array'
const S_base = 'base'
const S_boolean = 'boolean'

const S_function = 'function'
const S_number = 'number'
const S_object = 'object'
const S_string = 'string'
const S_null = 'null'
const S_key = 'key'
const S_parent = 'parent'
const S_MT = ''
const S_BT = '`'
const S_DS = '$'
const S_DT = '.'
const S_CN = ':'
const S_KEY = 'KEY'


// The standard undefined value for this language.
const UNDEF = undefined


// Keys are strings for maps, or integers for lists.
type PropKey = string | number


// For each key in a node (map or list), perform value injections in
// three phases: on key value, before child, and then on key value again.
// This mode is passed via the InjectState structure.
type InjectMode = 'key:pre' | 'key:post' | 'val'


// Handle value injections using backtick escape sequences:
// - `a.b.c`: insert value at {a:{b:{c:1}}}
// - `$FOO`: apply transform FOO
type InjectHandler = (
  state: Injection,  // Injection state.
  val: any,            // Injection value specification.
  current: any,        // Current source parent value.
  ref: string,         // Original injection reference string.
  store: any,          // Current source root value.
) => any


// Injection state used for recursive injection into JSON-like data structures.
type Injection = {
  mode: InjectMode          // Injection mode: key:pre, val, key:post.
  full: boolean             // Transform escape was full key name.
  keyI: number              // Index of parent key in list of parent keys.
  keys: string[]            // List of parent keys.
  key: string               // Current parent key.
  val: any                  // Current child value.
  parent: any               // Current parent (in transform specification).
  path: string[]            // Path to current node.
  nodes: any[]              // Stack of ancestor nodes.
  handler: InjectHandler    // Custom handler for injections.
  errs: any[]               // Error collector.  
  meta: Record<string, any> // Custom meta data.
  base?: string             // Base key for data in store, if any. 
  modify?: Modify           // Modify injection output.
}


// Apply a custom modification to injections.
type Modify = (
  val: any,            // Value.
  key?: PropKey,       // Value key, if any,
  parent?: any,        // Parent node, if any.
  state?: Injection,   // Injection state, if any.
  current?: any,       // Current value in store (matches path).
  store?: any,         // Store, if any
) => void


// Function applied to each node and leaf when walking a node structure depth first.
// NOTE: For {a:{b:1}} the call sequence args will be:
// b, 1, {b:1}, [a,b]
type WalkApply = (
  // Map keys are strings, list keys are numbers, top key is UNDEF 
  key: string | number | undefined,
  val: any,
  parent: any,
  path: string[]
) => any


// Value is a node - defined, and a map (hash) or list (array).
function isnode(val: any) {
  return null != val && S_object == typeof val
}


// Value is a defined map (hash) with string keys.
function ismap(val: any) {
  return null != val && S_object == typeof val && !Array.isArray(val)
}


// Value is a defined list (array) with integer keys (indexes).
function islist(val: any) {
  return Array.isArray(val)
}


// Value is a defined string (non-empty) or integer key.
function iskey(key: any) {
  const keytype = typeof key
  return (S_string === keytype && S_MT !== key) || S_number === keytype
}


// Check for an "empty" value - undefined, empty string, array, object.
function isempty(val: any) {
  return null == val || S_MT === val ||
    (Array.isArray(val) && 0 === val.length) ||
    (S_object === typeof val && 0 === Object.keys(val).length)
}


// Value is a function.
function isfunc(val: any) {
  return S_function === typeof val
}


// Safely get a property of a node. Undefined arguments return undefined.
// If the key is not found, return the alternative value, if any.
function getprop(val: any, key: any, alt?: any) {
  let out = alt

  if (UNDEF === val || UNDEF === key) {
    return alt
  }

  if (isnode(val)) {
    out = val[key]
  }

  if (UNDEF === out) {
    return alt
  }

  return out
}


// Sorted keys of a map, or indexes of a list.
function keysof(val: any): string[] {
  return !isnode(val) ? [] :
    ismap(val) ? Object.keys(val).sort() : val.map((_n: any, i: number) => '' + i)
}


// Value of property with name key in node val is defined.
function haskey(val: any, key: any) {
  return UNDEF !== getprop(val, key)
}


// List the sorted keys of a map or list as an array of tuples of the form [key, value].
function items(val: any): [number | string, any][] {
  return keysof(val).map((k: any) => [k, val[k]])
}


// Escape regular expression.
function escre(s: string) {
  s = null == s ? S_MT : s
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}


// Escape URLs.
function escurl(s: string) {
  s = null == s ? S_MT : s
  return encodeURIComponent(s)
}


// Concatenate url part strings, merging forward slashes as needed.
function joinurl(sarr: any[]) {
  return sarr
    .filter(s => null != s && '' !== s)
    .map((s, i) => 0 === i ? s.replace(/([^\/])\/+/, '$1/').replace(/\/+$/, '') :
      s.replace(/([^\/])\/+/, '$1/').replace(/^\/+/, '').replace(/\/+$/, ''))
    .filter(s => '' !== s)
    .join('/')
}


// Safely stringify a value for humans (NOT JSON!).
function stringify(val: any, maxlen?: number): string {
  let str = S_MT

  if (UNDEF === val) {
    return str
  }

  try {
    str = JSON.stringify(val, function(_key: string, val: any) {
      if (
        val !== null &&
        typeof val === "object" &&
        !Array.isArray(val)
      ) {
        const sortedObj: any = {}
        for (const k of Object.keys(val).sort()) {
          sortedObj[k] = val[k]
        }
        return sortedObj
      }
      return val
    })
  }
  catch (err: any) {
    str = S_MT + val
  }

  str = S_string !== typeof str ? S_MT + str : str
  str = str.replace(/"/g, '')

  if (null != maxlen) {
    let js = str.substring(0, maxlen)
    str = maxlen < str.length ? (js.substring(0, maxlen - 3) + '...') : str
  }

  return str
}


// Build a human friendly path string.
function pathify(val: any, from?: number) {
  let pathstr: string | undefined = UNDEF

  let path: any[] | undefined = islist(val) ? val :
    S_string == typeof val ? [val] :
      S_number == typeof val ? [val] :
        UNDEF
  const start = null == from ? 0 : -1 < from ? from : 0

  if (UNDEF != path && 0 <= start) {
    path = path.slice(start)
    if (0 === path.length) {
      pathstr = '<root>'
    }
    else {
      pathstr = path
        .filter((p: any, t: any) => (t = typeof p, S_string === t || S_number === t))
        .map((p: any) =>
          'number' === typeof p ? S_MT + Math.floor(p) :
            p.replace(/\./g, S_MT))
        .join(S_DT)
    }
  }

  if (UNDEF === pathstr) {
    pathstr = '<unknown-path' + (UNDEF === val ? S_MT : S_CN + stringify(val, 47)) + '>'
  }

  return pathstr
}


// Clone a JSON-like data structure.
// NOTE: function value references are copied, *not* cloned.
function clone(val: any): any {
  const refs: any[] = []
  const replacer: any = (_k: any, v: any) => S_function === typeof v ?
    (refs.push(v), '`$FUNCTION:' + (refs.length - 1) + '`') : v
  const reviver: any = (_k: any, v: any, m: any) => S_string === typeof v ?
    (m = v.match(/^`\$FUNCTION:([0-9]+)`$/), m ? refs[m[1]] : v) : v
  return UNDEF === val ? UNDEF : JSON.parse(JSON.stringify(val, replacer), reviver)
}


// Safely set a property. Undefined arguments and invalid keys are ignored.
// Returns the (possibly modified) parent.
// If the value is undefined the key will be deleted from the parent.
// If the parent is a list, and the key is negative, prepend the value.
// NOTE: If the key is above the list size, append the value; below, prepend.
// If the value is undefined, remove the list element at index key, and shift the
// remaining elements down.  These rules avoid "holes" in the list.
function setprop<PARENT>(parent: PARENT, key: any, val: any): PARENT {
  if (!iskey(key)) {
    return parent
  }

  if (ismap(parent)) {
    key = S_MT + key
    if (UNDEF === val) {
      delete (parent as any)[key]
    }
    else {
      (parent as any)[key] = val
    }
  }
  else if (islist(parent)) {
    // Ensure key is an integer.
    let keyI = +key

    if (isNaN(keyI)) {
      return parent
    }

    keyI = Math.floor(keyI)

    // Delete list element at position keyI, shifting later elements down.
    if (UNDEF === val) {
      if (0 <= keyI && keyI < parent.length) {
        for (let pI = keyI; pI < parent.length - 1; pI++) {
          parent[pI] = parent[pI + 1]
        }
        parent.length = parent.length - 1
      }
    }

    // Set or append value at position keyI, or append if keyI out of bounds.
    else if (0 <= keyI) {
      parent[parent.length < keyI ? parent.length : keyI] = val
    }

    // Prepend value if keyI is negative
    else {
      parent.unshift(val)
    }
  }

  return parent
}


// Walk a data structure depth first, applying a function to each value.
function walk(
  // These arguments are the public interface.
  val: any,
  apply: WalkApply,

  // These areguments are used for recursive state.
  key?: string | number,
  parent?: any,
  path?: string[]
): any {
  if (isnode(val)) {
    for (let [ckey, child] of items(val)) {
      setprop(val, ckey, walk(child, apply, ckey, val, [...(path || []), S_MT + ckey]))
    }
  }

  // Nodes are applied *after* their children.
  // For the root node, key and parent will be undefined.
  return apply(key, val, parent, path || [])
}


// Merge a list of values into each other. Later values have
// precedence.  Nodes override scalars. Node kinds (list or map)
// override each other, and do *not* merge.  The first element is
// modified.
function merge(val: any): any {
  let out: any = UNDEF

  // Handle edge cases.
  if (!islist(val)) {
    return val
  }

  const list = val as any[]
  const lenlist = list.length

  if (0 === lenlist) {
    return UNDEF
  }
  else if (1 === lenlist) {
    return list[0]
  }

  // Merge a list of values.
  out = getprop(list, 0, {})

  for (let oI = 1; oI < lenlist; oI++) {
    let obj = list[oI]

    if (!isnode(obj)) {
      // Nodes win.
      out = obj
    }
    else {
      // Nodes win, also over nodes of a different kind.
      if (!isnode(out) || (ismap(obj) && islist(out)) || (islist(obj) && ismap(out))) {
        out = obj
      }
      else {
        // Node stack. walking down the current obj.
        let cur = [out]
        let cI = 0

        function merger(
          key: string | number | undefined,
          val: any,
          parent: any,
          path: string[]
        ) {
          if (null == key) {
            return val
          }

          // Get the curent value at the current path in obj.
          // NOTE: this is not exactly efficient, and should be optimised.
          let lenpath = path.length
          cI = lenpath - 1
          if (UNDEF === cur[cI]) {
            cur[cI] = getpath(path.slice(0, lenpath - 1), out)
          }

          // Create node if needed.
          if (!isnode(cur[cI])) {
            cur[cI] = islist(parent) ? [] : {}
          }

          // Node child is just ahead of us on the stack, since
          // `walk` traverses leaves before nodes.
          if (isnode(val) && !isempty(val)) {
            setprop(cur[cI], key, cur[cI + 1])
            cur[cI + 1] = UNDEF
          }

          // Scalar child.
          else {
            setprop(cur[cI], key, val)
          }

          return val
        }

        // Walk overriding node, creating paths in output as needed.
        walk(obj, merger)
      }
    }
  }

  return out
}


// Get a value deep inside a node using a key path.  For example the
// path `a.b` gets the value 1 from {a:{b:1}}.  The path can specified
// as a dotted string, or a string array.  If the path starts with a
// dot (or the first element is ''), the path is considered local, and
// resolved against the `current` argument, if defined.  Integer path
// parts are used as array indexes.  The state argument allows for
// custom handling when called from `inject` or `transform`.
function getpath(path: string | string[], store: any, current?: any, state?: Injection) {

  // Operate on a string array.
  const parts = islist(path) ? path : S_string === typeof path ? path.split(S_DT) : UNDEF

  if (UNDEF === parts) {
    return UNDEF
  }

  let root = store
  let val = store
  const base = getprop(state, S_base)

  // An empty path (incl empty string) just finds the store.
  if (null == path || null == store || (1 === parts.length && S_MT === parts[0])) {
    // The actual store data may be in a store sub property, defined by state.base.
    val = getprop(store, base, store)
  }
  else if (0 < parts.length) {
    let pI = 0

    // Relative path uses `current` argument.
    if (S_MT === parts[0]) {
      pI = 1
      root = current
    }

    let part = pI < parts.length ? parts[pI] : UNDEF
    let first: any = getprop(root, part)

    // At top level, check state.base, if provided
    val = (UNDEF === first && 0 === pI) ?
      getprop(getprop(root, base), part) :
      first

    // Move along the path, trying to descend into the store.
    for (pI++; UNDEF !== val && pI < parts.length; pI++) {
      val = getprop(val, parts[pI])
    }

  }

  // State may provide a custom handler to modify found value.
  if (null != state && isfunc(state.handler)) {
    const ref = pathify(path)
    val = state.handler(state, val, current, ref, store)
  }

  return val
}


// Inject store values into a string. Not a public utility - used by
// `inject`.  Inject are marked with `path` where path is resolved
// with getpath against the store or current (if defined)
// arguments. See `getpath`.  Custom injection handling can be
// provided by state.handler (this is used for transform functions).
// The path can also have the special syntax $NAME999 where NAME is
// upper case letters only, and 999 is any digits, which are
// discarded. This syntax specifies the name of a transform, and
// optionally allows transforms to be ordered by alphanumeric sorting.
function _injectstr(
  val: string,
  store: any,
  current?: any,
  state?: Injection
): any {

  // Can't inject into non-strings
  if (S_string !== typeof val) {
    return S_MT
  }

  let out: any = val

  // Pattern examples: "`a.b.c`", "`$NAME`", "`$NAME1`"
  const m = val.match(/^`(\$[A-Z]+|[^`]+)[0-9]*`$/)

  // Full string of the val is an injection.
  if (m) {
    if (state) {
      state.full = true
    }
    let pathref = m[1]

    // Special escapes inside injection.
    pathref =
      3 < pathref.length ? pathref.replace(/\$BT/g, S_BT).replace(/\$DS/g, S_DS) : pathref

    // Get the extracted path reference.
    out = getpath(pathref, store, current, state)

    return out
  }

  // Check for injections within the string.
  out = val.replace(/`([^`]+)`/g,
    (_m: string, ref: string) => {

      // Special escapes inside injection.
      ref = 3 < ref.length ? ref.replace(/\$BT/g, S_BT).replace(/\$DS/g, S_DS) : ref
      if (state) {
        state.full = false
      }
      const found = getpath(ref, store, current, state)

      // Ensure inject value is a string.
      return UNDEF === found ? S_MT :
        S_object === typeof found ? JSON.stringify(found) :
          found
    })

  // Also call the state handler on the entire string, providing the
  // option for custom injection.
  if (null != state && isfunc(state.handler)) {
    state.full = true
    out = state.handler(state, out, current, val, store)
  }

  return out
}


// Inject values from a data store into a node recursively, resolving
// paths against the store, or current if they are local. THe modify
// argument allows custom modification of the result.  The state
// (InjectState) argument is used to maintain recursive state.
function inject(
  val: any,
  store: any,
  modify?: Modify,
  current?: any,
  state?: Injection,
) {
  const valtype = typeof val

  // Create state if at root of injection.  The input value is placed
  // inside a virtual parent holder to simplify edge cases.
  if (UNDEF === state) {
    const parent = { [S_DTOP]: val }

    // Set up state assuming we are starting in the virtual parent.
    state = {
      mode: S_MVAL as InjectMode,
      full: false,
      keyI: 0,
      keys: [S_DTOP],
      key: S_DTOP,
      val,
      parent,
      path: [S_DTOP],
      nodes: [parent],
      handler: injecthandler,
      base: S_DTOP,
      modify,
      errs: getprop(store, S_DERRS, []),
      meta: {},
    }
  }

  // Resolve current node in store for local paths.
  if (UNDEF === current) {
    current = { $TOP: store }
  }
  else {
    const parentkey = state.path[state.path.length - 2]
    current = null == parentkey ? current : getprop(current, parentkey)
  }

  // Descend into node.
  if (isnode(val)) {

    // Keys are sorted alphanumerically to ensure determinism.
    // Injection transforms ($FOO) are processed *after* other keys.
    // NOTE: the optional digits suffix of the transform can thus be
    // used to order the transforms.
    const origkeys = ismap(val) ? [
      ...Object.keys(val).filter(k => !k.includes(S_DS)),
      ...Object.keys(val).filter(k => k.includes(S_DS)).sort(),
    ] : val.map((_n: any, i: number) => i)


    // Each child key-value pair is processed in three injection phases:
    // 1. state.mode='key:pre' - Key string is injected, returning a possibly altered key.
    // 2. state.mode='val' - The child value is injected.
    // 3. state.mode='key:post' - Key string is injected again, allowing child mutation.
    for (let okI = 0; okI < origkeys.length; okI++) {
      const origkey = S_MT + origkeys[okI]

      let childpath = [...(state.path || []), origkey]
      let childnodes = [...(state.nodes || []), val]

      const childstate: Injection = {
        mode: S_MKEYPRE as InjectMode,
        full: false,
        keyI: okI,
        keys: origkeys,
        key: origkey,
        val,
        parent: val,
        path: childpath,
        nodes: childnodes,
        handler: injecthandler,
        base: state.base,
        errs: state.errs,
        meta: state.meta,
      }

      // Peform the key:pre mode injection on the child key.
      const prekey = _injectstr(origkey, store, current, childstate)

      // The injection may modify child processing.
      okI = childstate.keyI

      // Prevent further processing by returning an undefined prekey
      if (UNDEF !== prekey) {
        let child = getprop(val, prekey)
        childstate.mode = S_MVAL as InjectMode

        // Perform the val mode injection on the child value.
        // NOTE: return value is not used.
        inject(child, store, modify, current, childstate)

        // The injection may modify child processing.
        okI = childstate.keyI

        // Peform the key:post mode injection on the child key.
        childstate.mode = S_MKEYPOST as InjectMode
        _injectstr(origkey, store, current, childstate)

        // The injection may modify child processing.
        okI = childstate.keyI
      }
    }
  }

  // Inject paths into string scalars.
  else if (S_string === valtype) {
    state.mode = S_MVAL as InjectMode
    val = _injectstr(val, store, current, state)
    setprop(state.parent, state.key, val)
  }

  // Custom modification.
  if (modify) {
    modify(
      val,
      getprop(state, S_key),
      getprop(state, S_parent),
      state,
      current,
      store
    )
  }

  // Original val reference may no longer be correct.
  // This return value is only used as the top level result.
  return getprop(state.parent, S_DTOP)
}


// Default inject handler for transforms. If the path resolves to a function,
// call the function passing the injection state. This is how transforms operate.
const injecthandler: InjectHandler = (
  state: Injection,
  val: any,
  current: any,
  ref: string,
  store: any
): any => {

  // Only call val function if it is a special command ($NAME format).
  if (isfunc(val) &&
    (UNDEF === ref || ref.startsWith(S_DS))) {
    val = (val as InjectHandler)(state, val, current, ref, store)
  }

  // Update parent with value. Ensures references remain in node tree.
  else if (S_MVAL === state.mode && state.full) {
    setprop(state.parent, state.key, val)
  }

  return val
}


// The transform_* functions are special command inject handlers (see InjectHandler).

// Delete a key from a map or list.
const transform_DELETE: InjectHandler = (state: Injection) => {
  const { key, parent } = state
  setprop(parent, key, UNDEF)
  return UNDEF
}


// Copy value from source data.
const transform_COPY: InjectHandler = (state: Injection, _val: any, current: any) => {
  const { mode, key, parent } = state

  let out = key
  if (!mode.startsWith(S_MKEY)) {
    out = getprop(current, key)
    setprop(parent, key, out)
  }

  return out
}


// As a value, inject the key of the parent node.
// As a key, defined the name of the key property in the source object.
const transform_KEY: InjectHandler = (state: Injection, _val: any, current: any) => {
  const { mode, path, parent } = state

  // Do nothing in val mode.
  if (S_MVAL !== mode) {
    return UNDEF
  }

  // Key is defined by $KEY meta property.
  const keyspec = getprop(parent, S_DKEY)
  if (UNDEF !== keyspec) {
    setprop(parent, S_DKEY, UNDEF)
    return getprop(current, keyspec)
  }

  // Key is defined within general purpose $META object.
  return getprop(getprop(parent, S_DMETA), S_KEY, getprop(path, path.length - 2))
}


// Store meta data about a node.
const transform_META: InjectHandler = (state: Injection) => {
  const { parent } = state
  setprop(parent, S_DMETA, UNDEF)
  return UNDEF
}


// Merge a list of objects into the current object. 
// Must be a key in an object. The value is merged over the current object.
// If the value is an array, the elements are first merged using `merge`. 
// If the value is the empty string, merge the top level store.
// Format: { '`$MERGE`': '`source-path`' | ['`source-paths`', ...] }
const transform_MERGE: InjectHandler = (
  state: Injection, _val: any, current: any
) => {
  const { mode, key, parent } = state

  if (S_MKEYPRE === mode) { return key }

  // Operate after child values have been transformed.
  if (S_MKEYPOST === mode) {

    let args = getprop(parent, key)
    args = S_MT === args ? [current.$TOP] : Array.isArray(args) ? args : [args]

    // Remove the $MERGE command.
    setprop(parent, key, UNDEF)

    // Literals in the parent have precedence, but we still merg onto
    // the parent object, so that node tree references are not changed.
    const mergelist = [parent, ...args, clone(parent)]

    merge(mergelist)

    return key
  }

  return UNDEF
}


// Convert a node to a list.
// Format: ['`$EACH`', '`source-path-of-node`', child-template]
const transform_EACH: InjectHandler = (
  state: Injection,
  _val: any,
  current: any,
  ref: string,
  store: any
) => {
  const { mode, keys, path, parent, nodes } = state

  // Remove arguments to avoid spurious processing.
  if (keys) {
    keys.length = 1
  }

  // Defensive context checks.
  if (S_MVAL !== mode || null == path || null == nodes) {
    return UNDEF
  }

  // Get arguments.
  const srcpath = parent[1] // Path to source data.
  const child = clone(parent[2]) // Child template.

  // Source data
  const src = getpath(srcpath, store, current, state)

  // Create parallel data structures:
  // source entries :: child templates
  let tcurrent: any = []
  let tval: any = []

  const tkey = path[path.length - 2]
  const target = nodes[path.length - 2] || nodes[path.length - 1]

  // Create clones of the child template for each value of the current soruce.
  if (isnode(src)) {
    if (islist(src)) {
      tval = src.map(() => clone(child))
    }
    else {
      tval = Object.entries(src).map(n => ({
        ...clone(child),

        // Make a note of the key for $KEY transforms.
        [S_DMETA]: { KEY: n[0] }
      }))
    }

    tcurrent = Object.values(src)
  }

  // Parent structure.
  tcurrent = { $TOP: tcurrent }

  // Build the substructure.
  tval = inject(
    tval,
    store,
    state.modify,
    tcurrent,
  )

  setprop(target, tkey, tval)

  // Prevent callee from damaging first list entry (since we are in `val` mode).
  return tval[0]
}



// Convert a node to a map.
// Format: { '`$PACK`':['`source-path`', child-template]}
const transform_PACK: InjectHandler = (
  state: Injection,
  _val: any,
  current: any,
  ref: string,
  store: any
) => {
  const { mode, key, path, parent, nodes } = state

  // Defensive context checks.
  if (S_MKEYPRE !== mode || S_string !== typeof key || null == path || null == nodes) {
    return UNDEF
  }

  // Get arguments.
  const args = parent[key]
  const srcpath = args[0] // Path to source data.
  const child = clone(args[1]) // Child template.

  // Find key and target node.
  const keyprop = child[S_DKEY]
  const tkey = path[path.length - 2]
  const target = nodes[path.length - 2] || nodes[path.length - 1]

  // Source data
  let src = getpath(srcpath, store, current, state)

  // Prepare source as a list.
  src = islist(src) ? src :
    ismap(src) ? Object.entries(src)
      .reduce((a: any[], n: any) =>
        (n[1][S_DMETA] = { KEY: n[0] }, a.push(n[1]), a), []) :
      UNDEF

  if (null == src) {
    return UNDEF
  }

  // Get key if specified.
  let childkey: PropKey | undefined = getprop(child, S_DKEY)
  let keyname = UNDEF === childkey ? keyprop : childkey
  setprop(child, S_DKEY, UNDEF)

  // Build parallel target object.
  let tval: any = {}
  tval = src.reduce((a: any, n: any) => {
    let kn = getprop(n, keyname)
    setprop(a, kn, clone(child))
    const nchild = getprop(a, kn)
    setprop(nchild, S_DMETA, getprop(n, S_DMETA))
    return a
  }, tval)

  // Build parallel source object.
  let tcurrent: any = {}
  src.reduce((a: any, n: any) => {
    let kn = getprop(n, keyname)
    setprop(a, kn, n)
    return a
  }, tcurrent)

  tcurrent = { $TOP: tcurrent }

  // Build substructure.
  tval = inject(
    tval,
    store,
    state.modify,
    tcurrent,
  )

  setprop(target, tkey, tval)

  // Drop transform key.
  return UNDEF
}


// Transform data using spec.
// Only operates on static JSON-like data.
// Arrays are treated as if they are objects with indices as keys.
function transform(
  data: any, // Source data to transform into new data (original not mutated)
  spec: any, // Transform specification; output follows this shape
  extra?: any, // Additional store of data and transforms.
  modify?: Modify // Optionally modify individual values.
) {
  // Clone the spec so that the clone can be modified in place as the transform result.
  spec = clone(spec)

  const extraTransforms: any = {}
  const extraData = null == extra ? {} : items(extra)
    .reduce((a: any, n: any[]) =>
      (n[0].startsWith(S_DS) ? extraTransforms[n[0]] = n[1] : (a[n[0]] = n[1]), a), {})

  const dataClone = merge([
    clone(UNDEF === extraData ? {} : extraData),
    clone(UNDEF === data ? {} : data),
  ])

  // Define a top level store that provides transform operations.
  const store = {

    // The inject function recognises this special location for the root of the source data.
    // NOTE: to escape data that contains "`$FOO`" keys at the top level,
    // place that data inside a holding map: { myholder: mydata }.
    $TOP: dataClone,

    // Escape backtick (this also works inside backticks).
    $BT: () => S_BT,

    // Escape dollar sign (this also works inside backticks).
    $DS: () => S_DS,

    // Insert current date and time as an ISO string.
    $WHEN: () => new Date().toISOString(),

    $DELETE: transform_DELETE,
    $COPY: transform_COPY,
    $KEY: transform_KEY,
    $META: transform_META,
    $MERGE: transform_MERGE,
    $EACH: transform_EACH,
    $PACK: transform_PACK,

    // Custom extra transforms, if any.
    ...extraTransforms,
  }

  const out = inject(spec, store, modify, store)

  return out
}



// A required string value. NOTE: Rejects empty strings.
const validate_STRING: InjectHandler = (state: Injection, _val: any, current: any) => {
  let out = getprop(current, state.key)

  let t = typeof out
  if (S_string === t) {
    if (S_MT === out) {
      state.errs.push('Empty string at ' + pathify(state.path, 1))
      return UNDEF
    }
    else {
      return out
    }
  }
  else {
    state.errs.push(_invalidTypeMsg(state.path, S_string, t, out))
    return UNDEF
  }
}


// A required number value (int or float).
const validate_NUMBER: InjectHandler = (state: Injection, _val: any, current: any) => {
  let out = getprop(current, state.key)

  let t = typeof out
  if (S_number !== t) {
    state.errs.push(_invalidTypeMsg(state.path, S_number, t, out))
    return UNDEF
  }

  return out
}


// A required boolean value.
const validate_BOOLEAN: InjectHandler = (state: Injection, _val: any, current: any) => {
  let out = getprop(current, state.key)

  let t = typeof out
  if (S_boolean !== t) {
    state.errs.push(_invalidTypeMsg(state.path, S_boolean, t, out))
    return UNDEF
  }

  return out
}


// A required object (map) value (contents not validated).
const validate_OBJECT: InjectHandler = (state: Injection, _val: any, current: any) => {
  let out = getprop(current, state.key)

  let t = typeof out

  if (null == out || S_object !== t) {
    state.errs.push(_invalidTypeMsg(state.path, S_object, t, out))
    return UNDEF
  }

  return out
}


// A required array (list) value (contents not validated).
const validate_ARRAY: InjectHandler = (state: Injection, _val: any, current: any) => {
  let out = getprop(current, state.key)

  let t = typeof out
  if (!Array.isArray(out)) {
    state.errs.push(_invalidTypeMsg(state.path, S_array, t, out))
    return UNDEF
  }

  return out
}


// A required function value.
const validate_FUNCTION: InjectHandler = (state: Injection, _val: any, current: any) => {
  let out = getprop(current, state.key)

  let t = typeof out
  if (S_function !== t) {
    state.errs.push(_invalidTypeMsg(state.path, S_function, t, out))
    return UNDEF
  }

  return out
}


// Allow any value.
const validate_ANY: InjectHandler = (state: Injection, _val: any, current: any) => {
  let out = getprop(current, state.key)
  return out
}



// Specify child values for map or list.
// Map syntax: {'`$CHILD`': child-template }
// List syntax: ['`$CHILD`', child-template ]
const validate_CHILD: InjectHandler = (state: Injection, _val: any, current: any) => {
  const { mode, key, parent, keys, path } = state

  // Setup data structures for validation by cloning child template.

  // Map syntax.
  if (S_MKEYPRE === mode) {
    const child = getprop(parent, key)

    // Get corresponding current object.
    const pkey = path[path.length - 2]
    let tval = getprop(current, pkey)

    if (UNDEF == tval) {
      // Create an empty object as default.
      tval = {}
    }
    else if (!ismap(tval)) {
      state.errs.push(_invalidTypeMsg(
        state.path.slice(0, state.path.length - 1), S_object, typeof tval, tval))
      return UNDEF
    }

    const ckeys = keysof(tval)
    for (let ckey of ckeys) {
      setprop(parent, ckey, clone(child))

      // NOTE: modifying state! This extends the child value loop in inject.
      keys.push(ckey)
    }

    // Remove $CHILD to cleanup ouput.
    setprop(parent, key, UNDEF)
    return UNDEF
  }

  // List syntax.
  else if (S_MVAL === mode) {
    if (!islist(parent)) {
      // $CHILD was not inside a list.
      state.errs.push('Invalid $CHILD as value')
      return UNDEF
    }

    const child = parent[1]

    if (UNDEF === current) {
      // Empty list as default.
      parent.length = 0
      return UNDEF
    }
    else if (!islist(current)) {
      state.errs.push(_invalidTypeMsg(
        state.path.slice(0, state.path.length - 1), S_array, typeof current, current))
      state.keyI = parent.length
      return current
    }

    // Clone children abd reset state key index.
    // The inject child loop will now iterate over the cloned children,
    // validating them againt the current list values.
    else {
      current.map((_n, i) => parent[i] = clone(child))
      parent.length = current.length
      state.keyI = 0
      return current[0]
    }
  }

  return UNDEF
}



// Match at least one of the specified shapes.
// Syntax: ['`$ONE`', alt0, alt1, ...]okI
const validate_ONE: InjectHandler = (state: Injection, _val: any, current: any) => {
  const { mode, parent, path, nodes } = state

  // Only operate in val mode, since parent is a list.
  if (S_MVAL === mode) {
    state.keyI = state.keys.length

    // Shape alts.
    let tvals = parent.slice(1)

    // See if we can find a match.
    for (let tval of tvals) {

      // If match, then errs.length = 0
      let terrs: any[] = []
      validate(current, tval, UNDEF, terrs)

      // The parent is the list we are inside. Go up one level
      // to set the actual value.
      const grandparent = nodes[nodes.length - 2]
      const grandkey = path[path.length - 2]

      if (isnode(grandparent)) {

        // Accept current value if there was a match
        if (0 === terrs.length) {

          // Ensure generic type validation (in validate "modify") passes.
          setprop(grandparent, grandkey, current)
          return
        }

        // Ensure generic validation does not generate a spurious error.
        else {
          setprop(grandparent, grandkey, UNDEF)
        }
      }
    }

    // There was no match.

    const valdesc = tvals
      .map((v: any) => stringify(v))
      .join(', ')
      .replace(/`\$([A-Z]+)`/g, (_m: any, p1: string) => p1.toLowerCase())

    state.errs.push(_invalidTypeMsg(
      state.path.slice(0, state.path.length - 1),
      'one of ' + valdesc,
      typeof current, current))
  }
}


// This is the "modify" argument to inject. Use this to perform
// generic validation. Runs *after* any special commands.
const validation: Modify = (
  val: any,
  key?: any,
  parent?: any,
  state?: Injection,
  current?: any,
  _store?: any
) => {

  // Current val to verify.
  const cval = getprop(current, key)

  if (UNDEF === cval || UNDEF === state) {
    return UNDEF
  }

  const pval = getprop(parent, key)
  const t = typeof pval

  // Delete any special commands remaining.
  if (S_string === t && pval.includes(S_DS)) {
    return UNDEF
  }

  const ct = typeof cval

  // Type mismatch.
  if (t !== ct && UNDEF !== pval) {
    state.errs.push(_invalidTypeMsg(state.path, t, ct, cval))
    return UNDEF
  }
  else if (ismap(cval)) {
    if (!ismap(val)) {
      state.errs.push(_invalidTypeMsg(state.path, islist(val) ? S_array : t, ct, cval))
      return UNDEF
    }

    const ckeys = keysof(cval)
    const pkeys = keysof(pval)

    // Empty spec object {} means object can be open (any keys).
    if (0 < pkeys.length && true !== getprop(pval, '`$OPEN`')) {
      const badkeys = []
      for (let ckey of ckeys) {
        if (!haskey(val, ckey)) {
          badkeys.push(ckey)
        }
      }

      // Closed object, so reject extra keys not in shape.
      if (0 < badkeys.length) {
        state.errs.push('Unexpected keys at ' + pathify(state.path, 1) +
          ': ' + badkeys.join(', '))
      }
    }
    else {
      // Object is open, so merge in extra keys.
      merge([pval, cval])
      if (isnode(pval)) {
        delete pval['`$OPEN`']
      }
    }
  }
  else if (islist(cval)) {
    if (!islist(val)) {
      state.errs.push(_invalidTypeMsg(state.path, t, ct, cval))
    }
  }
  else {
    // Spec value was a default, copy over data
    setprop(parent, key, cval)
  }

  return UNDEF
}



// Validate a data structure against a shape specification.  The shape
// specification follows the "by example" principle.  Plain data in
// teh shape is treated as default values that also specify the
// required type.  Thus shape {a:1} validates {a:2}, since the types
// (number) match, but not {a:'A'}.  Shape {a;1} against data {}
// returns {a:1} as a=1 is the default value of the a key.  Special
// validation commands (in the same syntax as transform ) are also
// provided to specify required values.  Thus shape {a:'`$STRING`'}
// validates {a:'A'} but not {a:1}. Empty map or list means the node
// is open, and if missing an empty default is inserted.
function validate(
  data: any, // Source data to transform into new data (original not mutated)
  spec: any, // Transform specification; output follows this shape

  extra?: any, // Additional custom checks

  // Optionally modify individual values.
  collecterrs?: any,
) {
  const errs = collecterrs || []
  const out = transform(
    data,
    spec,
    {
      // A special top level value to collect errors.
      $ERRS: errs,

      // Remove the transform commands.
      $DELETE: null,
      $COPY: null,
      $KEY: null,
      $META: null,
      $MERGE: null,
      $EACH: null,
      $PACK: null,

      $STRING: validate_STRING,
      $NUMBER: validate_NUMBER,
      $BOOLEAN: validate_BOOLEAN,
      $OBJECT: validate_OBJECT,
      $ARRAY: validate_ARRAY,
      $FUNCTION: validate_FUNCTION,
      $ANY: validate_ANY,
      $CHILD: validate_CHILD,
      $ONE: validate_ONE,

      ...(extra || {})
    },

    validation
  )

  if (0 < errs.length && null == collecterrs) {
    throw new Error('Invalid data: ' + errs.join('\n'))
  }

  return out
}


// Internal utilities
// ==================


function _typify(val: any) {
  let t: string = typeof val
  t = null == val ? S_null :
    Array.isArray(val) ? S_array :
      t
  return t
}


// Build a type validation error message.
function _invalidTypeMsg(path: any, type: string, vt: string, v: any) {
  // Deal with js array type returns 'object' 
  vt = Array.isArray(v) && S_object === vt ? S_array : vt
  v = stringify(v)
  return 'Expected ' + type + ' at ' + pathify(path, 1) +
    ', found ' + (null != v ? vt + ': ' : '') + v
}





export {
  clone,
  escre,
  escurl,
  getpath,
  getprop,
  haskey,
  inject,
  isempty,
  isfunc,
  iskey,
  islist,
  ismap,
  isnode,
  items,
  joinurl,
  keysof,
  merge,
  pathify,
  setprop,
  stringify,
  transform,
  validate,
  walk,
}

export type {
  Injection,
  InjectHandler,
  WalkApply
}
