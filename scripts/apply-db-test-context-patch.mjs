import fs from "node:fs";

const path = "tests/database/reception_checkout.sql";
let content = fs.readFileSync(path, "utf8");
const before = `RESET ROLE;\n\n-- Cenário TISS: preparação e guia individual com versão vigente configurável.`;
const after = `RESET ROLE;\nSET LOCAL request.jwt.claim.sub = '';\nSET LOCAL request.jwt.claims = '{}';\n\n-- Cenário TISS: preparação e guia individual com versão vigente configurável.`;
if (!content.includes(before)) throw new Error("reception checkout scenario separator not found");
content = content.replace(before, after);
fs.writeFileSync(path, content);
