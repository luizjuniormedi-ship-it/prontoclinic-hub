const IDENTIFIER = /^[a-zA-Z_][a-zA-Z0-9_]*$/;
const SAFE_RELATION_PROJECTION = /^[a-zA-Z0-9_:,()\s]+$/;

function projectionError(message) {
  const error = new Error(message);
  error.statusCode = 400;
  return error;
}

function splitTopLevelProjection(selectParam) {
  const tokens = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < selectParam.length; index += 1) {
    const char = selectParam[index];
    if (char === '(') {
      depth += 1;
    } else if (char === ')') {
      depth -= 1;
      if (depth < 0) {
        throw projectionError('select com parenteses desbalanceados');
      }
    } else if (char === ',' && depth === 0) {
      tokens.push(selectParam.slice(start, index).trim());
      start = index + 1;
    }
  }

  if (depth !== 0) {
    throw projectionError('select com parenteses desbalanceados');
  }

  tokens.push(selectParam.slice(start).trim());
  return tokens.filter(Boolean);
}

function validateEmbeddedRelation(token) {
  if (!SAFE_RELATION_PROJECTION.test(token) || !token.endsWith(')')) {
    throw projectionError(`relacao invalida no select: ${token}`);
  }

  const firstParenthesis = token.indexOf('(');
  const relation = token.slice(0, firstParenthesis).trim();
  const relationParts = relation.split(':');
  if (
    firstParenthesis <= 0 ||
    relationParts.length > 2 ||
    relationParts.some((part) => !IDENTIFIER.test(part))
  ) {
    throw projectionError(`relacao invalida no select: ${token}`);
  }
}

export function parseSelectProjection(selectParam) {
  if (!selectParam) return null;

  const tokens = splitTopLevelProjection(selectParam);
  const columns = [];
  let selectAll = false;

  for (const token of tokens) {
    if (token === '*') {
      selectAll = true;
      continue;
    }
    if (token.includes('(') || token.includes(')')) {
      validateEmbeddedRelation(token);
      continue;
    }
    if (!IDENTIFIER.test(token)) {
      throw projectionError(`coluna invalida no select: ${token}`);
    }
    columns.push(`"${token}"`);
  }

  if (selectAll) return '*';
  return columns.length > 0 ? columns.join(', ') : null;
}
