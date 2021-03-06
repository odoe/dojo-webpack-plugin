/*
 * (C) Copyright IBM Corp. 2017 All Rights Reserved.
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */
const util = require('util');
const path = require('path');
const fs = require('fs');
const vm = require("vm");
const {plugin} = require("./pluginHelper");
const CommonJsRequireDependency = require("webpack/lib/dependencies/CommonJsRequireDependency");
const ConstDependency = require("webpack/lib/dependencies/ConstDependency");
const BasicEvaluatedExpression = require("webpack/lib/BasicEvaluatedExpression");

const embeddedLoaderFilenameExpression = "__embedded_dojo_loader__";


module.exports = class DojoLoaderPlugin {
	constructor(options) {
		this.options = options;
	}

	apply(compiler) {
		this.compiler = compiler;
		plugin(compiler, [
			[["run", "watch-run"],           this.run1],
			[["run", "watch-run"],           this.run2],
			["get dojo require",             this.getDojoRequire],
			["get dojo config",              this.getBuildLoaderConfig],
			["embedded-dojo-loader",         this.embeddedDojoLoader],
			["create-dojo-loader-scope",     this.createLoaderScope],
			["create-embedded-loader-scope", this.createEmbeddedLoaderScope]
		], this);
		compiler.plugin("compilation", (compilation, params) => {
			const context = Object.create(this, {
				compilation:{value: compilation},
				params:{value: params}
			});
			if (compilation.compiler === compiler) {
				// Don't do this for child compilations
				//  https://github.com/OpenNTF/dojo-webpack-plugin/issues/115
				compiler.plugin("make", this.validateEmbeddedLoader.bind(context));
			}
			plugin(compilation, [
				["succeed-module",        this.succeedModule],
				["after-optimize-chunks", this.afterOptimizeChunks]
			], context);
			// Support for the __embedded_dojo_loader__ webpack variable.  This allows applications (and unit tests)
			// to require the embedded loader module with require(__embedded_dojo_loader__);
			params.normalModuleFactory.plugin("parser", (parser) => {
				const context2 = Object.create(context, {parser: {value: parser}});
				plugin(parser, [
					["expression " + embeddedLoaderFilenameExpression ,         this.expressionLoader],
					["evaluate typeof " + embeddedLoaderFilenameExpression,     this.evaluateTypeofLoader],
					["evaluate Identifier " + embeddedLoaderFilenameExpression, this.evaluateIdentifierLoader],
					// Ensure that the embedded loader doesn't pull in node dependencies for process and global
					[["expression process", "expression global"],               this.expressionNode]
				], context2);
			});
		});
	}

	containsModule(chunk, module) {
		return (chunk.containsModule) ? chunk.containsModule(module) : /* istanbul ignore next */ chunk.modules.indexOf(module) !== -1;
	}

	getDojoPath(loaderConfig) {
		var dojoPath;
		if (!loaderConfig.packages || !loaderConfig.packages.some((pkg) => {
			if (pkg.name === "dojo") {
				return dojoPath = path.resolve(loaderConfig.baseUrl, pkg.location);
			}
		})) {
			return path.join(require.resolve("dojo/dojo.js"), "..");
		}
		return dojoPath;
	}

	getOrCreateEmbeddedLoader(dojoPath, loaderConfig, options, callback) {
		var dojoLoaderPath;
		if (options.loader) {
			try {
				 dojoLoaderPath = require.resolve(options.loader);
				 fs.readFile(dojoLoaderPath, "utf-8", (err, content) => {
					 return callback(err, content);
				 });
			} catch (error) {
				return callback(error);
			}
		} else {
			if (!options.noConsole) {
				console.log("Dojo loader not specified in options.  Building the loader...");
			}
			const child_process = require("child_process");
			const tmp = require("tmp");
			// create temporary directory to hold output
			tmp.dir({unsafeCleanup: true}, (err, tempDir) => {
				if (err) {
					return callback(err);
				}
				const featureOverrides = {};
				if (!util.isString(options.loaderConfig)) {
					// If config is not a module, then honor the 'dojo-config-api' has feature if specified
					if (loaderConfig.has && ('dojo-config-api' in loaderConfig.has) && !loaderConfig.has['dojo-config-api']) {
						featureOverrides['dojo-config-api'] = 0;
					}
				}
				child_process.execFile(
					"node", // the executable to run
					[	// The arguments
						path.resolve(__dirname, "../buildDojo", "buildRunner.js"),
						"load=build",
						"--dojoPath",
						path.resolve(loaderConfig.baseUrl, dojoPath, "./dojo"), 	// path to dojo.js
						"--profile",
						path.join(__dirname, "../buildDojo/loader.profile.js"), // the build profile
						"--release",
						"--releaseDir",
						tempDir,	// target location
						"--has",
						JSON.stringify(featureOverrides)
					], (error, stdout, stderr) => {
						if (error) {
							console.error(stderr.toString());
							callback(error);
						} else {
							if (!options.noConsole) {
								console.log(stdout.toString());
							}
							options.loader = path.join(tempDir, "dojo/dojo.js");
							dojoLoaderPath = require.resolve(path.join(options.loader));
							fs.readFile(dojoLoaderPath, "utf-8", (err, content) => { // eslint-disable-line no-shadow
								callback(err, content);
							});
						}
					}
				);
			});
		}
	}

	createLoaderScope(loaderConfig, loader, filename) {
		const loaderScope = {};
		loaderScope.global = loaderScope.window = loaderScope;
		loaderScope.dojoConfig = Object.assign({}, loaderConfig);
		loaderScope.dojoConfig.has = Object.assign({}, this.getDefaultFeaturesForEmbeddedLoader(), loaderScope.dojoConfig.has, {"dojo-config-api":1, "dojo-publish-privates":1});
		var context = vm.createContext(loaderScope);
		vm.runInContext('(function(global, window) {' + loader + '});', context, filename).call(context, context);
		return loaderScope;
	}

	createEmbeddedLoaderScope(userConfig, embeddedLoader, filename) {
		const loaderScope = {};
		const defaultConfig = {hasCache:{}, modules:{}};
		loaderScope.global = loaderScope.window = loaderScope;
		var context = vm.createContext(loaderScope);
		vm.runInContext("var module = {};" + embeddedLoader, context, filename).call(context, userConfig, defaultConfig, context, context);
		return loaderScope;
	}

	validateEmbeddedLoader(compilation__, callback) {
		// Vefiry that embedded loader version and dojo version are the same
		this.params.normalModuleFactory.create({
			dependencies: [{request: "dojo/package.json"}]
		}, (err, pkgModule) => {
			if (!err) {
				 const dojoVersion = require(pkgModule.request).version;
				 const scope = this.compiler.applyPluginsBailResult("create-embedded-loader-scope", {}, this.embeddedLoader, this.filename);
				 if (dojoVersion !== scope.loaderVersion) {
					 err = new Error(
`Dojo loader version does not match the version of Dojo.
Loader version = ${scope.loaderVersion}.
Dojo version = ${dojoVersion}.
You may need to rebuild the Dojo loader.
Refer to https://github.com/OpenNTF/dojo-webpack-plugin/blob/master/README.md#building-the-dojo-loader`);
				 }
				 return callback(err, scope);
			}
			callback(err);
		});
	}

	getBuildLoaderConfig() {
		var loaderConfig = this.options.loaderConfig;
		if (util.isString(loaderConfig)) {
			loaderConfig = require(loaderConfig);
		}
		if (typeof loaderConfig === 'function') {
			loaderConfig = loaderConfig(this.options.buildEnvironment || this.options.environment || {});
		}
		loaderConfig.baseUrl = path.resolve(this.compiler.context, loaderConfig.baseUrl || ".").replace(/\\/g, "/");
		return loaderConfig;
	}

	run1(compilation__, callback) {
		// Load the Dojo loader and get the require function into loaderScope
		var loaderConfig = this.compiler.applyPluginsBailResult("get dojo config");
		var dojoPath;
		try {
			dojoPath = this.getDojoPath(loaderConfig);
		} catch (e) {
			return callback(e);
		}
		var filename = path.join(dojoPath, "dojo.js");
		fs.readFile(filename, 'utf-8', (err, content) => {
			if (err) return callback(err);
			this.compiler.applyPlugins("dojo-loader", content, filename);
			this.loaderScope = this.compiler.applyPluginsBailResult("create-dojo-loader-scope", loaderConfig, content, filename);
			return callback();
		});
	}

	run2(compilation__, callback) {
		// Load the Dojo loader and get the require function into loaderScope
		var loaderConfig = this.compiler.applyPluginsBailResult("get dojo config");
		var dojoPath;
		try {
			dojoPath = this.getDojoPath(loaderConfig);
		} catch (e) {
			return callback(e);
		}
		this.getOrCreateEmbeddedLoader(dojoPath, loaderConfig, this.options, (err, content) => {
			// options.loader specifies path to the embedded loader (set by createEmbeddedLoader if created)
			if (!err) {
				this.compiler.applyPlugins("embedded-dojo-loader", content, this.options.loader);
			}
			callback(err);
		});
	}

	getDojoRequire() {
		return this.loaderScope.require;
	}

	embeddedDojoLoader(content, filename) {
		this.embeddedLoader = content;
		this.embeddedLoaderFilename = filename;
	}

	succeedModule(module) {
		const {options} = this;
		if (!module.issuer) {
			// No issuer generally means an entry module, so add a Dojo loader dependency.  It doesn't
			// hurt to add extra dependencies because the Dojo loader module will be removed from chunks
			// that don't need it in the 'after-optimize-chunks' handler below.
			module.addDependency(new CommonJsRequireDependency(options.loader));
			if (util.isString(options.loaderConfig)) {
				module.addDependency(new CommonJsRequireDependency(options.loaderConfig));
			}
		}
	}

	afterOptimizeChunks(chunks) {
		// Get the loader and loader config
		const {options, compilation, containsModule} = this;
		const loaderModule = compilation.modules.find((module) => { return module.rawRequest === options.loader;});
		const configModule = util.isString(options.loaderConfig) &&
								compilation.modules.find((module) => { return module.rawRequest === options.loaderConfig;});

		// Ensure that the Dojo loader, and optionally the loader config, are included
		// only in the entry chunks that contain the webpack runtime.
		chunks.forEach((chunk) => {
			if (chunk.hasRuntime()) {
				if (!loaderModule) {
					throw Error("Can't locate " + options.loader + " in compilation");
				}
				if (util.isString(options.loaderConfig) && !configModule) {
					throw Error("Can't locate " + options.loaderConfig + " in compilation");
				}
				if (!containsModule(chunk, loaderModule)) {
					chunk.addModule(loaderModule);
					loaderModule.addChunk(chunk);
				}
				if (configModule && !containsModule(chunk, configModule)) {
					chunk.addModule(configModule);
					configModule.addChunk(chunk);
				}
			} else if (loaderModule) {
				if (containsModule(chunk, loaderModule)) {
					chunk.removeModule(loaderModule);
					loaderModule.removeChunk(chunk);
				}
				if (configModule && containsModule(chunk, configModule)) {
					chunk.removeModule(configModule);
					configModule.removeChunk(chunk);
				}
			}
		});
	}

	expressionLoader(expr) {
		// change __embedded_dojo_loader__ expressions in the source to the filename value as a string.
		const {parser} = this;
		const fn = parser.applyPluginsBailResult("evaluate Identifier " + embeddedLoaderFilenameExpression, expr).string.replace(/\\/g, "\\\\");
		const dep = new ConstDependency("\"" + fn + "\"", expr.range);
		dep.loc = expr.loc;
		parser.state.current.addDependency(dep);
		return true;
	}

	evaluateTypeofLoader(expr) {
		// implement typeof operator for the expression
		var result = new BasicEvaluatedExpression().setString("string");
		if (expr) {
			result.setRange(expr.range);
		}
		return result;
	}

	evaluateIdentifierLoader(expr) {
		var result = new BasicEvaluatedExpression().setString(this.embeddedLoaderFilename);
		if (expr) {
			result.setRange(expr.range);
		}
		return result;
	}

	expressionNode() {
		const {parser} = this;
		const embeddedLoaderFileName = parser.applyPluginsBailResult("evaluate Identifier __embedded_dojo_loader__").string;
		if(parser.state.module && parser.state.module.request === embeddedLoaderFileName) {
			return false;
		}
	}

	getDefaultFeaturesForEmbeddedLoader() {
		return require("../buildDojo/loaderDefaultFeatures");
	}
};