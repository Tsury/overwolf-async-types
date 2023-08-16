import { Project } from "ts-morph";
import fs from "fs";

const project = new Project();
const orgDefs = project.addSourceFileAtPath("types/overwolf.d.ts");

const convertedFuncs = new Set();

// These functions are read only, until Overwolf changes them to be writable, we will create a new async function with the same name + "Async" suffix for them
const readOnlyFuncs = [
  "io.dir",
  "io.readBinaryFile",
  "io.readTextFile",
  "io.exist",
];

let currNamespace = "";
let fullFunctionName = "";

orgDefs.getStatements().forEach((statement) => {
  // Go over every namespace declaration
  if (statement.getKindName() !== "ModuleDeclaration") {
    return;
  }

  // Omit the "overwolf." prefix
  currNamespace = statement.getName().replace("overwolf.", "");

  const functionsToAdd = [];

  statement.forEachDescendant((functionDeclaration) => {
    // Go over every function declaration
    if (functionDeclaration.getKindName() !== "FunctionDeclaration") {
      return;
    }

    fullFunctionName = `${currNamespace}.${functionDeclaration.getName()}`;

    const params = functionDeclaration.getParameters();
    const lastParam = params[params.length - 1];

    if (lastParam?.getName() !== "callback") {
      // No last param, or last param name not 'callback' - no need to convert
      return;
    }

    const typeText = lastParam.getTypeNode()?.getText();

    if (!typeText?.startsWith("CallbackFunction")) {
      // Last param is not a CallbackFunction - no need to convert
      return;
    }

    // Extracting generic type from the CallbackFunction
    const match = typeText.match(/CallbackFunction<(.+)>/);

    if (match && match[1]) {
      let newAsyncFunction = functionDeclaration;

      if (readOnlyFuncs.includes(fullFunctionName)) {
        // In case of a read only function, we create a new function with the same name with an "async" suffix
        const newFunctionName = functionDeclaration.getName() + "Async";

        // Clone the function declaration, omitting the last param and changing return type to be a promise
        newAsyncFunction = {
          name: newFunctionName,
          parameters: params.slice(0, -1).map((p) => ({
            name: p.getName(),
            type: p.getTypeNode()?.getText() || "any",
          })),
          returnType: `Promise<${match[1]}>`,
          docs: functionDeclaration
            .getJsDocs()
            .map((jsDoc) => jsDoc.getStructure()),
        };

        // Change the last param tag to be a return tag
        newAsyncFunction.docs.forEach((jsDoc) => {
          const lastParamTag = jsDoc.tags[jsDoc.tags.length - 1];
          lastParamTag.tagName = "returns";
          lastParamTag.text = `{Promise} A promise that wraps [${
            lastParamTag.text || "callback doc is missing"
          }].`;
        });

        // Will be added to the namespace later to avoid changing the iteration
        functionsToAdd.push(newAsyncFunction);
      } else {
        // Remove callback param
        lastParam.remove();

        // Set return value as a promise with the existing generic type
        functionDeclaration.setReturnType(`Promise<${match[1]}>`);

        const jsDocs = newAsyncFunction.getJsDocs();

        // Change the last param tag to be a return tag
        jsDocs.forEach((jsDoc) => {
          const paramTags = jsDoc.getTags();
          const lastParamTag = paramTags[paramTags.length - 1];

          if (lastParamTag?.getName() === "callback") {
            const lastParamTagComment = lastParamTag.getComment();

            lastParamTag.remove();

            jsDoc.addTag({
              tagName: "returns",
              text: `{Promise} A promise that wraps [${
                lastParamTagComment || "callback doc is missing"
              }].`,
            });
          }
        });

        convertedFuncs.add(fullFunctionName);
      }
    }
  });

  functionsToAdd.forEach((func) => {
    statement.addFunction(func);
  });
});

orgDefs.saveSync();

const promisifyCode = `
const readOnlyFuncs = ${JSON.stringify(readOnlyFuncs)};

const asyncFuncs = ${JSON.stringify([
  ...Array.from(convertedFuncs),
  ...readOnlyFuncs,
])};

export const promisify = () => {
  asyncFuncs.forEach((funcName) => {
    const pathParts = funcName.split('.');
    let owObj = overwolf;

    // Find the parent object of the function
    for (let i = 0; i < pathParts.length - 1; i++) {
      owObj = owObj[pathParts[i]];
    }

    // Don't wrap if the function doesn't exist (discrepancy between the types and the actual API)
    if (!owObj) {
      return;
    }

    const funcName = pathParts[pathParts.length - 1];
    let targetFuncName = funcName;

    if (readOnlyFuncs.includes(funcName)) {
      // Add async suffix to read only functions
      targetFuncName = funcName + 'Async';
    } else {
      var descriptor = Object.getOwnPropertyDescriptor(owObj, funcName);
  
      // Don't wrap if the function is not writable - should not happen
      if (!descriptor?.writable) {
        return;
      }
    }

    // Wrap the function with a promise
    owObj[targetFuncName] = async (...args) => new Promise((resolve, reject) => {
      try {
        owObj[funcName](...args, (result) => {
          result?.success ? resolve(result) : reject(new Error(result.error || 'Unknown error')));
        });
      } catch (error) {
        reject(error);
      }
    });
  });
}
`;

fs.writeFile("promisify.js", promisifyCode, (err) => {
  if (err) {
    throw err;
  }
});
