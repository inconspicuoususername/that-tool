import vm from "vm";

export async function runCode(code: string) {
  let outputBufferIsolate = "";

  if (code.includes(`async ()`)) {
    throw new Error(
      "Don't wrap the code in an IIFE, just execute it directly."
    );
  }

  const puppeteer = await import("puppeteer");

  await new Promise((resolve, reject) => {
    const sandbox = vm.createContext({
      puppeteer,
      resolve,
      reject,
      console: {
        log: (...args: any[]) => {
          outputBufferIsolate +=
            args?.map((x) => x?.toString()).join(" ") + "\n";
        },
      },
    });
    vm.runInContext(
      `(async () => {try { ${code};resolve(); } catch (e) { reject(e) }})()`,
      sandbox
    );
  });

  return outputBufferIsolate;
}

// async function runIsolatedCode(code: string) {
//   let outputBufferIsolate = "";

//   function customLog(...args: any[]) {
//     outputBufferIsolate += args?.map((x) => x?.toString()).join(" ") + "\n";
//   }

//   // Create a new Isolate
//   const isolate = new ivm.Isolate({ memoryLimit: 128 }); // Set memory limit in MB

//   // Create a new Context within the Isolate
//   const context = await isolate.createContext();

//   // Get a reference to the global object within the context
//   const jail = context.global;

//   // Expose a variable to the isolated context
//   const puppeteer = await import("puppeteer");
//   await jail.set("puppeteer", puppeteer, { copy: true });
//   await jail.set("console", {
//     log: (...args: any[]) => {
//       customLog(...args);
//     },
//   });

//   // Compile and run the code
//   const script = await isolate.compileScript(`
//     ${code}
//   `);
//   await script.run(context);

//   //   // Retrieve the result from the isolated context
//   //   const result = await jail.get("result", { copy: true });

//   // Dispose of the isolate to release resources
//   isolate.dispose();

//   return outputBufferIsolate;
// }
