/** 暂停指定毫秒，返回可 await 的 Promise。 */
export function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
