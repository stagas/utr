import { add, addAsync, throws } from './fixture'

describe('add(a, b)', () => {
  it('adds two numbers together', () => {
    expect(add(1, 2)).toEqual(3)
  })

  it('fails!', () => {
    expect(add(1, 2)).toBe(4)
  })

  it('adds async', async () => {
    expect(await addAsync(1, 2)).toEqual(5)
  })

  describe('deeper', () => {
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
})
