// Sustituye por dobles de prueba los módulos que no podemos usar de verdad.
export async function resolve(specifier, context, next) {
  if (specifier.startsWith("https://www.gstatic.com/firebasejs/")) {
    return { url: new URL("./stubs/firebase.mjs", import.meta.url).href, shortCircuit: true };
  }
  if (specifier === "./config.js" && (context.parentURL || "").includes("/js/")) {
    return { url: new URL("./stubs/config.mjs", import.meta.url).href, shortCircuit: true };
  }
  return next(specifier, context);
}
