import { Project } from "ts-morph";
import fs from "fs";

const project = new Project();
const orgDefs = project.addSourceFileAtPath("types/overwolf.d.ts");

const convertedFuncs = new Set();

// Remember the index of the callback param in functions that have a callback param but it's not the last param
const nonLastCallbackFunc = {};

// Remember functions with callbacks not of type CallbackFunction
const nonCallbackFunctionCallbacks = new Set();

// These functions are read only, until Overwolf changes them to be writable, we will create a new async function with the same name + "Async" suffix for them
const readOnlyFuncs = [
  "io.dir",
  "io.readBinaryFile",
  "io.readTextFile",
  "io.exist",
];

const supportedCallbackNames = ["callback", "resultCallback"];

let currNamespace = "";
let fullFunctionName = "";

orgDefs.getStatements().forEach((statement) => {
  // Go over every namespace declaration
  if (statement.getKindName() !== "ModuleDeclaration") {
    console.log(statement.getKindName());
    return;
  }

  // Omit the "overwolf." prefix
  currNamespace = statement.getName().replace("overwolf.", "");

  const functionsToAdd = [];

  statement.forEachDescendant((functionDeclaration) => {
    // Go over every enum declaration
    if (functionDeclaration.getKindName() === "EnumDeclaration") {
      // Remove the "const" modifier from the enum
      if (functionDeclaration.getStructure().isConst) {
        functionDeclaration.removeModifier("const");
      }

      return;
    }

    // Go over every function declaration
    if (functionDeclaration.getKindName() !== "FunctionDeclaration") {
      return;
    }

    fullFunctionName = `${currNamespace}.${functionDeclaration.getName()}`;

    const params = functionDeclaration.getParameters();

    let callbackIndex = -1;

    for (let i = 0; i < params.length; i++) {
      if (supportedCallbackNames.includes(params[i]?.getName() || "")) {
        callbackIndex = i;
        break;
      }
    }

    if (callbackIndex === -1) {
      // No callback param, or callback name not supported
      return;
    }

    if (callbackIndex !== params.length - 1) {
      // The callback param is not the last param
      nonLastCallbackFunc[fullFunctionName] = callbackIndex;
    }

    const callbackParam = params[callbackIndex];
    const typeText = callbackParam.getTypeNode()?.getText();

    let returnPromiseType = "void";

    if (typeText?.startsWith("CallbackFunction")) {
      // Extracting generic type from the CallbackFunction
      const match = typeText.match(/CallbackFunction<(.+)>/);

      if (match && match[1]) {
        returnPromiseType = match[1];
      } else {
        // Can't find generic type - should not happen
        return;
      }
    } else {
      // Extract the type of the callback parameter
      const callbackType = callbackParam.getType();
      // If it's a function type, get its signature
      const signatures = callbackType.getCallSignatures();

      if (signatures.length > 0) {
        // Get the parameters of the signature
        const signatureParams = signatures[0].getParameters();

        // Assuming only one parameter
        if (signatureParams.length > 0) {
          // Get the type of the first parameter
          const firstParamType =
            signatureParams[0].getTypeAtLocation(callbackParam);
          const firstParam = firstParamType.getText();
          returnPromiseType = firstParam;
        }
      }

      nonCallbackFunctionCallbacks.add(fullFunctionName);
    }

    let newAsyncFunction = functionDeclaration;

    if (readOnlyFuncs.includes(fullFunctionName)) {
      // In case of a read only function, we create a new function with the same name with an "async" suffix
      const newFunctionName = functionDeclaration.getName() + "Async";

      // Clone the function declaration, omitting the callback param and changing return type to be a promise
      newAsyncFunction = {
        name: newFunctionName,
        parameters: [
          ...params.slice(0, callbackIndex),
          ...params.slice(callbackIndex + 1),
        ].map((p) => ({
          name: p.getName(),
          type: p.getTypeNode()?.getText() || "any",
        })),
        returnType: `Promise<${returnPromiseType}>`,
        docs: functionDeclaration
          .getJsDocs()
          .map((jsDoc) => jsDoc.getStructure()),
      };

      // Change the callback param tag to be a return tag
      newAsyncFunction.docs.forEach((jsDoc) => {
        const callbackParamTag = jsDoc.tags[jsDoc.tags.length - 1];
        callbackParamTag.tagName = "returns";
        callbackParamTag.text = `{Promise} A promise that wraps [${
          callbackParamTag.text || "callback doc is missing"
        }].`;
      });

      // Will be added to the namespace later to avoid changing the iteration
      functionsToAdd.push(newAsyncFunction);
    } else {
      // Remove callback param
      callbackParam.remove();

      // Set return value as a promise with the existing generic type
      functionDeclaration.setReturnType(`Promise<${returnPromiseType}>`);

      const jsDocs = newAsyncFunction.getJsDocs();

      // Change the callback param tag to be a return tag
      jsDocs.forEach((jsDoc) => {
        const paramTags = jsDoc.getTags();
        const callbackParamTag = paramTags[paramTags.length - 1];

        if (callbackParamTag?.getName() === "callback") {
          const lastParamTagComment = callbackParamTag.getComment();

          callbackParamTag.remove();

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
const nonLastCallbackFunc = ${JSON.stringify(nonLastCallbackFunc)};
const nonCallbackFunctionCallbacks = ${JSON.stringify(
  Array.from(nonCallbackFunctionCallbacks)
)};

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

    const sourceFuncName = pathParts[pathParts.length - 1];
    let targetFuncName = sourceFuncName;

    if (readOnlyFuncs.includes(funcName)) {
      // Add async suffix to read only functions
      targetFuncName = sourceFuncName + 'Async';
    } else {
      var descriptor = Object.getOwnPropertyDescriptor(owObj, sourceFuncName);
  
      // Don't wrap if the function is not writable - should not happen
      if (!descriptor?.writable) {
        return;
      }
    }

    const orgFunc = owObj[sourceFuncName];

    // Wrap the function with a promise - use nonLastCallbackFunc to determine the callback index
    // Use nonCallbackFunctionCallbacks to determine if the callback is a function or arbitrary data
    owObj[targetFuncName] = async (...args) => new Promise((resolve, reject) => {
      try {
        const orgFuncArgs = [...args];
        const callbackIndex = nonLastCallbackFunc[funcName] || args.length;
        orgFuncArgs.splice(callbackIndex, 0, (result) => {
          if (nonCallbackFunctionCallbacks[funcName]) {
            resolve(result); // Handle arbitrary data
          } else {
            result.success ? resolve(result) : reject(new Error(result.error || 'Unknown error'));
          }
        });
        orgFunc(...orgFuncArgs);
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
