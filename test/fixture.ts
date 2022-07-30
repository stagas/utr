export const add = (a: number, b: number) => a + b
export const addAsync = async (a: number, b: number) => a + b
export const throws = () => {
  throw new ReferenceError('an error happened')
}
