// Claves de traduccion tipadas: `t("nav.party")` se valida contra es.json
// (es es el diccionario de referencia; en.json debe tener las mismas claves,
// lo comprueba src/i18n/i18n.test.ts).
import type es from "./es.json";

declare module "i18next" {
  interface CustomTypeOptions {
    defaultNS: "translation";
    resources: { translation: typeof es };
  }
}
