import { Project } from "ts-morph";
import fs from "fs";

const project = new Project();
const orgDefs = project.addSourceFileAtPath("overwolfTypes/overwolf.d.ts");

// Delete org file to prevent conflicts.
fs.unlink("overwolfTypes/overwolf.d.ts", (err) => {
  if (err) {
    throw err;
  }
});

const convertedFuncs = new Set();

let currNamespace = "";
let fullFunctionName = "";

orgDefs.getStatements().forEach((statement) => {
  // Go over every namespace declaration
  if (statement.getKindName() !== "ModuleDeclaration") {
    return;
  }

  currNamespace = statement.getName().replace("overwolf.", "");

  statement.forEachDescendant((functionDeclaration) => {
    // Go over every function declaration
    if (functionDeclaration.getKindName() !== "FunctionDeclaration") {
      return;
    }

    fullFunctionName = `${currNamespace}.${functionDeclaration.getName()}`;

    const params = functionDeclaration.getParameters();
    const lastParam = params[params.length - 1];

    if (!lastParam) {
      // No last param - no need to convert
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
      // Remove callback param
      lastParam.remove();

      // Set return value as a promise with the existing generic type
      functionDeclaration.setReturnType(`Promise<${match[1]}>`);

      convertedFuncs.add(fullFunctionName);
    }
  });
});

const newFile = project.createSourceFile(
  "overwolf.d.ts",
  orgDefs.getFullText(),
  {
    overwrite: true,
  }
);

newFile.saveSync();

const promisifyCode = `
const convertedFuncs = ${JSON.stringify(Array.from(convertedFuncs))};

export const promisify = () => {
  convertedFuncs.forEach((funcName) => {
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

    var descriptor = Object.getOwnPropertyDescriptor(owObj, funcName);
  
    // Don't wrap if the function is not writable
    if (!descriptor?.writable) {
      return;
    }

    // Wrap the function with a promise
    owObj[funcName] = async (...args) => new Promise((resolve, reject) => {
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
