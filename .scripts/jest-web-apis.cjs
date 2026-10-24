// Jest's jsdom environment omits Node's browser-compatible codecs. Install them
// before application imports (including ky) can evaluate their module globals.
const codecs = require("node:util");

for (const name of ["TextEncoder", "TextDecoder"]) {
  if (typeof globalThis[name] !== "function") {
    Object.defineProperty(globalThis, name, {
      configurable: true,
      writable: true,
      value: codecs[name],
    });
  }
}
