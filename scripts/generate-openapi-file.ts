import { generateOpenAPIDocument } from "../src/openapi/generator";
import * as fs from "fs";
import * as path from "path";

const doc = generateOpenAPIDocument();
const dest = path.resolve(__dirname, "../openapi.yaml");
fs.writeFileSync(dest, JSON.stringify(doc, null, 2));
console.log("Generated openapi.yaml successfully at", dest);
