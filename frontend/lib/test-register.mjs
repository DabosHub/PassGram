import { register } from "node:module";

process.env.PASSGRAM_REGISTRY_CODE_CHECK = "off";

register("./ts-hook.mjs", import.meta.url);
