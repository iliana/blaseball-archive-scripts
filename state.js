/* this is inspired by but is entirely unlike react's useState */
export function useState() {
  const data = {};
  let resolve;
  const ready = new Promise((f) => {
    resolve = f;
  });

  return [
    async () => {
      await ready;
      return data.value;
    },
    (value) => {
      data.value = value;
      if (resolve !== undefined) {
        resolve();
        resolve = undefined;
      }
    },
  ];
}
