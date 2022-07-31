import { add, addAsync, throws } from './fixture'

let ba = 0
let ba2 = 0

let ae2 = 0

describe('add(a, b)', () => {
  let be = 0
  let be2 = 0

  beforeEach(() => {
    be++
  })

  it('adds two numbers together', () => {
    expect(add(1, 2)).toEqual(3)
  })

  it('fails!', () => {
    expect(add(1, 2)).toBe(4)
  })

  it('fails adds async', async () => {
    expect(await addAsync(1, 2)).toEqual(5)
  })

  it('beforeEach works', () => {
    expect(be).toBe(4)
  })

  describe('deeper', () => {
    beforeEach(async () => {
      be2++
    })

    afterEach(async () => {
      ae2++
    })

    it('also works', async () => {
      await new Promise(resolve => setTimeout(resolve, 100))
      expect(await addAsync(5, 5)).toBe(10)
    })

    it('comes after the async one', () => {
      expect(add(5, 5)).toBe(10)
    })

    it('random throw', () => {
      throw new SyntaxError('random throw')
    })

    it('imported throw', () => {
      expect(throws()).toBe(true)
    })

    it('expected throw', () => {
      expect(() => throws()).toThrow('an errorc')
    })

    it('beforeEach async', () => {
      expect(be).toBe(5)
      expect(be2).toBe(6)
      expect(ba2).toBe(1)
    })

    it('afterEach async', () => {
      expect(ae2).toBe(6)
    })

    beforeAll(() => {
      ba2++
    })
  })

  it('after deep', () => {
    expect(add(1, 2)).toBe(3)
  })

  it('snapshot', () => {
    // const foo = { yes: 'a reference' }
    // console.log(serialize({ what: new Map<any, any>([[1, { hello: 'world' }], [2, foo]]) }, 2))
    // expect({ what: new Map<any, any>([[1, { hello: 'world' }], [2, foo]]), foo }).toMatchSnapshot()
    expect({ hello: 'world', foo: 'bawqwr!' }).toMatchSnapshot()
    expect({ hello: 'wt?!!', foo: 'barzwewe' }).toMatchSnapshot()
  })

  it('beforeEach continues', () => {
    expect(be).toBe(8)
    expect(be2).toBe(7)
    expect(ba2).toBe(1)
  })

  it('beforeAll works', () => {
    expect(ba).toBe(1)
  })
})

describe('beforeAll really works', () => {
  it('works', () => {
    expect(ba).toBe(1)
  })
})

beforeAll(() => {
  ba++
})

afterAll(() => {
  expect(ba).toBe(1)
})
