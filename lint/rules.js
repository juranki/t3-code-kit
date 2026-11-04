// The project's own lint rules: the conventions in AGENTS.md and
// docs/design/sbx-seam.md that were documented but not enforced.
//
// Each rule is deliberately small and AST-shaped. They are registered in
// `vite.config.ts` under `lint.jsPlugins` and enabled at `error`, so a
// violation fails `npm run check`. `lint/README.md` says which convention each
// rule encodes and which files it applies to.
import { definePlugin, defineRule } from "vite-plus/lint/plugins";

const PRODUCTION_SOURCE = /\/(?:packages|apps)\/[^/]+\/src\//u;
const TEST_FILE = /\.test\.ts$/u;
const SEAM_SOURCE = /\/packages\/sbx\/src\//u;
const SEAM_COMMAND = /\/packages\/sbx\/src\/command\.ts$/u;
const HOST_PROCESS = /\/packages\/host\/src\/HostProcess\.ts$/u;

const isProductionSource = (filename) =>
  PRODUCTION_SOURCE.test(filename) && !TEST_FILE.test(filename);

const isSeamSource = (filename) => SEAM_SOURCE.test(filename);

const isSeamCommand = (filename) => SEAM_COMMAND.test(filename);

const isHostProcess = (filename) => HOST_PROCESS.test(filename);

const isNode = (value) =>
  value !== null && typeof value === "object" && typeof value.type === "string";

const unwrap = (node) => {
  let current = node;
  while (
    current !== null &&
    typeof current === "object" &&
    (current.type === "ChainExpression" ||
      current.type === "TSAsExpression" ||
      current.type === "TSSatisfiesExpression" ||
      current.type === "TSNonNullExpression" ||
      current.type === "ParenthesizedExpression")
  ) {
    current = current.expression;
  }
  return current;
};

/** Walk an expression subtree without following parent pointers. */
const walk = (root, visit, skipFunctions = false) => {
  if (!isNode(root)) return;
  if (
    skipFunctions &&
    (root.type === "FunctionExpression" ||
      root.type === "ArrowFunctionExpression" ||
      root.type === "FunctionDeclaration" ||
      root.type === "ClassExpression" ||
      root.type === "ClassDeclaration")
  ) {
    return;
  }
  visit(root);
  for (const [key, value] of Object.entries(root)) {
    if (key === "parent" || key === "loc" || key === "range" || key === "start" || key === "end") {
      continue;
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, visit, skipFunctions);
    } else if (isNode(value)) {
      walk(value, visit, skipFunctions);
    }
  }
};

const memberName = (node) => {
  const expression = unwrap(node);
  if (expression === null || expression.type !== "MemberExpression") return undefined;
  if (!expression.computed && expression.property.type === "Identifier") {
    return expression.property.name;
  }
  if (expression.computed && expression.property.type === "Literal") {
    return typeof expression.property.value === "string" ? expression.property.value : undefined;
  }
  if (expression.computed && expression.property.type === "StringLiteral") {
    return expression.property.value;
  }
  return undefined;
};

const calleeName = (callee) => {
  const expression = unwrap(callee);
  if (expression === null) return undefined;
  if (expression.type === "Identifier") return expression.name;
  return memberName(expression);
};

const isMethodCall = (node, name) => {
  const expression = unwrap(node);
  return (
    expression !== null &&
    expression.type === "CallExpression" &&
    calleeName(expression.callee) === name
  );
};

/** A call to `<something>.<name>(...)`, e.g. `sbx.exec(...)`. */
const findMethodCall = (root, name) => {
  let found;
  walk(
    root,
    (node) => {
      if (found !== undefined) return;
      if (isMethodCall(node, name)) found = node;
    },
    true,
  );
  return found;
};

/** A call to the seam's `sbx.<name>(...)`, not a regex's `.exec()`. */
const isSbxMethodCall = (node, name) => {
  const expression = unwrap(node);
  if (expression === null || expression.type !== "CallExpression") return false;
  const callee = unwrap(expression.callee);
  if (callee === null || callee.type !== "MemberExpression") return false;
  if (memberName(callee) !== name) return false;
  const object = unwrap(callee.object);
  return object !== null && object.type === "Identifier" && object.name === "sbx";
};

const findSbxMethodCall = (root, name) => {
  let found;
  walk(
    root,
    (node) => {
      if (found !== undefined) return;
      if (isSbxMethodCall(node, name)) found = node;
    },
    true,
  );
  return found;
};

const containsRender = (root) => findMethodCall(root, "render") !== undefined;

const isArgvish = (node) => {
  const expression = unwrap(node);
  if (expression === null) return false;
  if (expression.type === "Identifier") {
    return expression.name === "args" || expression.name === "argv";
  }
  if (expression.type === "MemberExpression") {
    const name = memberName(expression);
    if (name === "args" || name === "argv") return true;
    return name === "slice" && isArgvish(expression.object);
  }
  if (expression.type === "CallExpression") {
    const callee = unwrap(expression.callee);
    if (callee === null || callee.type !== "MemberExpression") return false;
    const name = memberName(callee);
    return (name === "slice" || name === "map") && isArgvish(callee.object);
  }
  if (expression.type === "ArrayExpression") {
    return expression.elements.some(
      (element) =>
        element !== null && element.type === "SpreadElement" && isArgvish(element.argument),
    );
  }
  return false;
};

const findAncestor = (node, type) => {
  let current = node.parent;
  while (current !== undefined && current !== null) {
    if (current.type === type) return current;
    current = current.parent;
  }
  return undefined;
};

const SHELL_SINKS = new Set([
  "exec",
  "execSync",
  "execFile",
  "execFileSync",
  "spawn",
  "spawnSync",
  "sh",
  "bash",
  "run",
  "runSync",
  "runCommand",
]);

const isShellSink = (name) => SHELL_SINKS.has(name);

const resolveVariable = (sourceCode, identifier) => {
  let scope = sourceCode.getScope(identifier);
  while (scope !== null) {
    const variable = scope.set.get(identifier.name);
    if (variable !== undefined) return variable;
    scope = scope.upper;
  }
  return undefined;
};

const isVendoredSpecifier = (specifier) =>
  typeof specifier === "string" && /(?:^|\/)repos(?:\/|$)/u.test(specifier);

const isNodeBuiltin = (specifier) =>
  typeof specifier === "string" && (specifier === "os" || specifier.startsWith("node:"));

const noVendoredImport = defineRule({
  meta: {
    type: "problem",
    docs: {
      description: "The vendored tree under repos/ is reference material, never an import target.",
    },
    messages: {
      vendored:
        "Do not import from the vendored tree ({{specifier}}). Use the package dependency instead; repos/ is read-only reference source.",
    },
  },
  create(context) {
    const check = (source) => {
      if (source !== null && source !== undefined && isVendoredSpecifier(source.value)) {
        context.report({
          node: source,
          messageId: "vendored",
          data: { specifier: source.value },
        });
      }
    };
    return {
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
      CallExpression: (node) => {
        if (calleeName(node.callee) !== "require") return;
        const [argument] = node.arguments;
        if (argument !== undefined && argument.type === "Literal") check(argument);
        if (argument !== undefined && argument.type === "StringLiteral") check(argument);
      },
    };
  },
});

const hostProcessOnly = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Node globals are turned into references in packages/host/src/HostProcess.ts, nowhere else.",
    },
    messages: {
      builtin:
        "Do not import Node's {{specifier}} here. Read the host fact from @t3ck/host/HostProcess; that module is the one place allowed to touch Node globals.",
      process:
        "Do not read the `process` global here. Read the host fact from @t3ck/host/HostProcess; that module is the one place allowed to touch Node globals.",
    },
  },
  create(context) {
    if (!isProductionSource(context.filename) || isHostProcess(context.filename)) return {};
    return {
      ImportDeclaration: (node) => {
        if (isNodeBuiltin(node.source?.value)) {
          context.report({
            node: node.source,
            messageId: "builtin",
            data: { specifier: node.source.value },
          });
        }
      },
      ImportExpression: (node) => {
        if (isNodeBuiltin(node.source?.value)) {
          context.report({
            node: node.source,
            messageId: "builtin",
            data: { specifier: node.source.value },
          });
        }
      },
      CallExpression: (node) => {
        if (calleeName(node.callee) !== "require") return;
        const [argument] = node.arguments;
        const value =
          argument?.type === "Literal" || argument?.type === "StringLiteral"
            ? argument.value
            : undefined;
        if (isNodeBuiltin(value)) {
          context.report({ node: argument, messageId: "builtin", data: { specifier: value } });
        }
      },
      Identifier: (node) => {
        if (node.name !== "process") return;
        // `obj.process`, `{ process: ... }` and `process` as a property key are
        // not reads of the global.
        if (node.parent !== undefined && node.parent !== null) {
          const parent = node.parent;
          if (
            (parent.type === "MemberExpression" && parent.property === node && !parent.computed) ||
            ((parent.type === "Property" || parent.type === "PropertyDefinition") &&
              parent.key === node &&
              !parent.computed) ||
            parent.type === "ImportSpecifier" ||
            parent.type === "ExportSpecifier" ||
            parent.type === "LabeledStatement"
          ) {
            return;
          }
        }
        // A local binding named `process` shadows the global and is not a
        // host read. An unresolved `process` is the Node global.
        const variable = resolveVariable(context.sourceCode, node);
        if (variable !== undefined && variable.defs.length > 0) return;
        context.report({ node, messageId: "process" });
      },
    };
  },
});

const stderrMember = (node) => {
  const expression = unwrap(node);
  if (expression === null) return undefined;
  if (expression.type === "MemberExpression" && memberName(expression) === "stderr") {
    return expression;
  }
  if (expression.type === "CallExpression") {
    const callee = unwrap(expression.callee);
    if (
      callee !== null &&
      callee.type === "MemberExpression" &&
      memberName(callee) === "test" &&
      expression.arguments.some((argument) => stderrMember(argument) !== undefined)
    ) {
      return expression.arguments.find((argument) => stderrMember(argument) !== undefined);
    }
  }
  return undefined;
};

const STDERR_INSPECTORS = new Set([
  "includes",
  "match",
  "matchAll",
  "startsWith",
  "endsWith",
  "indexOf",
  "lastIndexOf",
  "search",
]);

const inspectsStderrContent = (root) => {
  let found;
  const direct = stderrMember(root);
  if (direct !== undefined) return direct;
  walk(root, (node) => {
    if (found !== undefined) return;
    if (node.type === "CallExpression") {
      const callee = unwrap(node.callee);
      if (callee === null || callee.type !== "MemberExpression") return;
      const method = memberName(callee);
      if (
        method !== undefined &&
        STDERR_INSPECTORS.has(method) &&
        stderrMember(callee.object) !== undefined
      ) {
        found = callee.object;
      }
    }
    if (node.type === "BinaryExpression") {
      const contentComparison = new Set(["==", "===", "!=", "!==", "<", ">", "<=", ">="]);
      if (!contentComparison.has(node.operator)) return;
      const left = stderrMember(node.left);
      const right = stderrMember(node.right);
      if (left !== undefined) found = left;
      else if (right !== undefined) found = right;
    }
  });
  return found;
};

const noStderrSwitch = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "Switch on the error tag; stderr is an attribute. Only the seam may translate stderr into a tag.",
    },
    messages: {
      stderr:
        "Do not branch on `stderr` content here. Switch on the error's `_tag`; the seam is the only place that turns stderr text into a tag.",
    },
  },
  create(context) {
    if (!isProductionSource(context.filename) || isSeamSource(context.filename)) return {};
    const check = (root) => {
      const offending = inspectsStderrContent(root);
      if (offending !== undefined) context.report({ node: offending, messageId: "stderr" });
    };
    return {
      IfStatement: (node) => check(node.test),
      ConditionalExpression: (node) => check(node.test),
      WhileStatement: (node) => check(node.test),
      DoWhileStatement: (node) => check(node.test),
      ForStatement: (node) => {
        if (node.test !== null && node.test !== undefined) check(node.test);
      },
      SwitchStatement: (node) => check(node.discriminant),
    };
  },
});

const noRenderToShell = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "command.render is for logs and tests; a rendered command must never reach a shell.",
    },
    messages: {
      render:
        "Do not pass a `command.render` result to {{sink}}. A command is argv data; hand the array to the seam, never a rendered string.",
    },
  },
  create(context) {
    const tainted = new Set();
    const sourceCode = context.sourceCode;
    const taintedIn = (root) => {
      let found = false;
      walk(root, (node) => {
        if (found) return;
        if (containsRender(node)) {
          found = true;
          return;
        }
        if (node.type === "Identifier") {
          const variable = resolveVariable(sourceCode, node);
          if (variable !== undefined && tainted.has(variable)) found = true;
        }
      });
      return found;
    };
    return {
      VariableDeclarator: (node) => {
        if (node.init === null || node.init === undefined) return;
        if (!containsRender(node.init)) return;
        for (const variable of sourceCode.getDeclaredVariables(node)) tainted.add(variable);
      },
      CallExpression: (node) => {
        const sink = calleeName(node.callee);
        if (sink === undefined || !isShellSink(sink)) return;
        if (!node.arguments.some((argument) => taintedIn(argument))) return;
        context.report({ node, messageId: "render", data: { sink } });
      },
    };
  },
});

const noArgvJoin = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "The seam never joins argv into a string. A multi-line script stays one argv element.",
    },
    messages: {
      join: "Do not join argv into a string. Keep each argv element separate and let the seam pass the array to the process.",
    },
  },
  create(context) {
    if (!isProductionSource(context.filename) || isSeamCommand(context.filename)) return {};
    return {
      CallExpression: (node) => {
        if (calleeName(node.callee) !== "join") return;
        const callee = unwrap(node.callee);
        if (callee === null || callee.type !== "MemberExpression") return;
        if (!isArgvish(callee.object)) return;
        context.report({ node, messageId: "join" });
      },
    };
  },
});

const execVsExecChecked = defineRule({
  meta: {
    type: "problem",
    docs: {
      description:
        "exec is exit-code-as-data; execChecked is for an action whose non-zero exit is a failure.",
    },
    messages: {
      execNotInspected:
        "This `exec` result is never inspected. Use `execChecked` when a non-zero exit is a failure, or read `exitCode` when the exit code is data.",
      execCheckedInspected:
        "`execChecked` already fails on a non-zero exit, so its `exitCode` is always 0. Use `exec` when the exit code is data.",
    },
  },
  create(context) {
    if (!isProductionSource(context.filename) || isSeamSource(context.filename)) return {};
    const sourceCode = context.sourceCode;
    const tracked = new Map();
    const inspected = new Set();
    return {
      VariableDeclarator: (node) => {
        if (node.id.type !== "Identifier" || node.init === null || node.init === undefined) return;
        const exec = findSbxMethodCall(node.init, "exec");
        const checked = findSbxMethodCall(node.init, "execChecked");
        const found = checked ?? exec;
        if (found === undefined) return;
        const [variable] = sourceCode.getDeclaredVariables(node);
        if (variable === undefined) return;
        tracked.set(variable, {
          kind: checked === undefined ? "exec" : "execChecked",
          node: found,
        });
      },
      MemberExpression: (node) => {
        if (memberName(node) !== "exitCode") return;
        const object = unwrap(node.object);
        if (object === null || object.type !== "Identifier") return;
        const variable = resolveVariable(sourceCode, object);
        if (variable !== undefined && tracked.has(variable)) inspected.add(variable);
      },
      CallExpression: (node) => {
        if (!isSbxMethodCall(node, "exec")) return;
        const declarator = findAncestor(node, "VariableDeclarator");
        if (
          declarator !== undefined &&
          declarator.init !== null &&
          declarator.init !== undefined &&
          findSbxMethodCall(declarator.init, "exec") === node
        ) {
          return;
        }
        context.report({ node, messageId: "execNotInspected" });
      },
      "Program:exit": () => {
        for (const [variable, entry] of tracked) {
          const wasInspected = inspected.has(variable);
          if (entry.kind === "exec" && !wasInspected) {
            context.report({ node: entry.node, messageId: "execNotInspected" });
          }
          if (entry.kind === "execChecked" && wasInspected) {
            context.report({ node: entry.node, messageId: "execCheckedInspected" });
          }
        }
      },
    };
  },
});

export default definePlugin({
  meta: { name: "t3ck" },
  rules: {
    "no-vendored-import": noVendoredImport,
    "host-process-only": hostProcessOnly,
    "no-stderr-switch": noStderrSwitch,
    "no-render-to-shell": noRenderToShell,
    "no-argv-join": noArgvJoin,
    "exec-vs-exec-checked": execVsExecChecked,
  },
});
