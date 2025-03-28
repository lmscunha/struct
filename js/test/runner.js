// This test utility runs the JSON-specified tests in build/test/test.json.

const { readFileSync } = require('node:fs')
const { join } = require('node:path')
const { deepEqual, fail, AssertionError } = require('node:assert')


// Runner does make use of these struct utilities, and this usage is
// circular. This is a trade-off tp make the runner code simpler.
const {
  clone,
  getpath,
  inject,
  items,
  stringify,
  walk,
} = require('../src/struct')


const NULLMARK = "__NULL__"


class Client {

  #opts = {}
  #utility = {}
  
  constructor(opts) {
    this.#opts = opts || {}
    this.#utility = {
      struct: {
        clone,
        getpath,
        inject,
        items,
        stringify,
        walk,
      },
      check: (ctx) => {
        return {
          zed: 'ZED' +
            (null == this.#opts ? '' : null == this.#opts.foo ? '' : this.#opts.foo) +
            '_' +
            (null == ctx.bar ? '0' : ctx.bar)
        }
      }
    }
  }

  static async test(opts) {
    return new Client(opts)
  }

  utility() { 
    return this.#utility 
  }
}


async function runner(
  name,
  store,
  testfile
) {

  const client = await Client.test()
  const utility = client.utility()
  const structUtils = utility.struct
  
  let spec = resolveSpec(name, testfile)
  let clients = await resolveClients(spec, store, structUtils)
  let subject = resolveSubject(name, utility)

  let runsetflags = async (
    testspec,
    flags,
    testsubject
  ) => {
    subject = testsubject || subject
    flags = resolveFlags(flags)
    const testspecmap = fixJSON(testspec, flags)

    const testset = testspecmap.set
    for (let entry of testset) {
      try {
        entry = resolveEntry(entry, flags)

        let testpack = resolveTestPack(name, entry, subject, client, clients)
        let args = resolveArgs(entry, testpack)

        let res = await testpack.subject(...args)
        res = fixJSON(res, flags)
        entry.res = res

        checkResult(entry, res, structUtils)
      }
      catch (err) {
        handleError(entry, err, structUtils)
      }
    }
  }

  let runset = async (
    testspec,
    testsubject
  ) => runsetflags(testspec, {}, testsubject)

  const runpack = {
    spec,
    runset,
    runsetflags,
    subject,
  }

  return runpack
}


function resolveSpec(name, testfile) {
  const alltests =
    JSON.parse(readFileSync(join(
      __dirname, testfile), 'utf8'))

  let spec = alltests.primary?.[name] || alltests[name] || alltests
  return spec
}


async function resolveClients(
  spec,
  store,
  structUtils
) {
  const clients = {}
  if (spec.DEF && spec.DEF.client) {
    for (let cn in spec.DEF.client) {
      const cdef = spec.DEF.client[cn]
      const copts = cdef.test.options || {}
      if ('object' === typeof store && structUtils?.inject) {
        structUtils.inject(copts, store)
      }

      clients[cn] = await Client.test(copts)
    }
  }
  return clients
}


function resolveSubject(name, container) {
  return container?.[name]
}


function resolveFlags(flags) {
  if (null == flags) {
    flags = {}
  }
  flags.null = null == flags.null ? true : !!flags.null
  return flags
}


function resolveEntry(entry, flags) {
  entry.out = null == entry.out && flags.null ? NULLMARK : entry.out
  return entry
}


function checkResult(entry, res, structUtils) {
  if (undefined === entry.match || undefined !== entry.out) {
    // NOTE: don't use clone as we want to strip functions
    deepEqual(null != res ? JSON.parse(JSON.stringify(res)) : res, entry.out)
  }

  if (entry.match) {
    match(
      entry.match,
      { in: entry.in, out: entry.res, ctx: entry.ctx },
      structUtils
    )
  }
}


// Handle errors from test execution
function handleError(entry, err, structUtils) {
  entry.thrown = err

  const entry_err = entry.err

  if (null != entry_err) {
    if (true === entry_err || matchval(entry_err, err.message, structUtils)) {
      if (entry.match) {
        match(
          entry.match,
          { in: entry.in, out: entry.res, ctx: entry.ctx, err },
          structUtils
        )
      }
      return
    }

    fail('ERROR MATCH: [' + structUtils.stringify(entry_err) +
      '] <=> [' + err.message + ']')
  }
  // Unexpected error (test didn't specify an error expectation)
  else if (err instanceof AssertionError) {
    fail(err.message + '\n\nENTRY: ' + JSON.stringify(entry, null, 2))
  }
  else {
    fail(err.stack + '\\nnENTRY: ' + JSON.stringify(entry, null, 2))
  }
}


function resolveArgs(entry, testpack) {
  let args = [clone(entry.in)]

  if (entry.ctx) {
    args = [entry.ctx]
  }
  else if (entry.args) {
    args = entry.args
  }

  if (entry.ctx || entry.args) {
    let first = args[0]
    if ('object' === typeof first && null != first) {
      entry.ctx = first = args[0] = clone(args[0])
      first.client = testpack.client
      first.utility = testpack.utility
    }
  }

  return args
}


function resolveTestPack(
  name,
  entry,
  subject,
  client,
  clients
) {
  const testpack = {
    client,
    subject,
    utility: client.utility(),
  }

  if (entry.client) {
    testpack.client = clients[entry.client]
    testpack.utility = testpack.client.utility()
    testpack.subject = resolveSubject(name, testpack.utility)
  }

  return testpack
}


function match(
  check,
  base,
  structUtils
) {
  structUtils.walk(check, (_key, val, _parent, path) => {
    let scalar = 'object' != typeof val
    if (scalar) {
      let baseval = structUtils.getpath(path, base)

      if (!matchval(val, baseval, structUtils)) {
        fail('MATCH: ' + path.join('.') +
             ': [' + structUtils.stringify(val) +
             '] <=> [' + structUtils.stringify(baseval) + ']')
      }
    }
  })
}


function matchval(
  check,
  base,
  structUtils
) {
  check = NULLMARK === check ? undefined : check

  let pass = check === base

  if (!pass) {

    if ('string' === typeof check) {
      let basestr = structUtils.stringify(base)

      let rem = check.match(/^\/(.+)\/$/)
      if (rem) {
        pass = new RegExp(rem[1]).test(basestr)
      }
      else {
        pass = basestr.toLowerCase().includes(structUtils.stringify(check).toLowerCase())
      }
    }
    else if ('function' === typeof check) {
      pass = true
    }
  }

  return pass
}


function fixJSON(val, flags) {
  if (null == val) {
    return flags.null ? NULLMARK : val
  }

  const replacer = (_k, v) => null == v && flags.null ? NULLMARK : v
  return JSON.parse(JSON.stringify(val, replacer))
}


function nullModifier(
  val,
  key,
  parent
) {
  if ("__NULL__" === val) {
    parent[key] = null
  }
  else if ('string' === typeof val) {
    parent[key] = val.replaceAll('__NULL__', 'null')
  }
}


module.exports = {
  NULLMARK,
  nullModifier,
  runner,
  Client
}
