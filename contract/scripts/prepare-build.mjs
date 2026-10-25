import { mkdirSync } from "node:fs";

mkdirSync(new URL("../build/", import.meta.url), { recursive: true });
