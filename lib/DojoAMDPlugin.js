/*
 * (C) Copyright IBM Corp. 2012, 2016 All Rights Reserved.
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
const path = require("path");
const DojoAMDDefineDependency = require("./DojoAMDDefineDependency");
const DojoAMDRequireItemDependency = require("./DojoAMDRequireItemDependency");
const NormalModuleReplacementPlugin = require("webpack/lib/NormalModuleReplacementPlugin");

const NullFactory = require("webpack/lib/NullFactory");

const DojoAMDRequireDependenciesBlockParserPlugin = require("./DojoAMDRequireDependenciesBlockParserPlugin");
const DojoAMDDefineDependencyParserPlugin = require("./DojoAMDDefineDependencyParserPlugin");
const DojoAMDMiscParserPlugin = require("./DojoAMDMiscParserPlugin");
const DojoAMDMainTemplatePlugin = require("./DojoAMDMainTemplatePlugin");
const DojoAMDChunkTemplatePlugin = require("./DojoAMDChunkTemplatePlugin");
const DojoAMDResolverPlugin = require("./DojoAMDResolverPlugin");
const DojoAMDModuleFactoryPlugin = require("./DojoAMDModuleFactoryPlugin");
const DojoLoaderPlugin = require("./DojoLoaderPlugin");
const DojoAMDRequireArrayDependency =  require("./DojoAMDRequireArrayDependency");
const ScopedRequirePlugin = require("./ScopedRequirePlugin");

module.exports = class DojoAMDPlugin {
	constructor(options) {
		this.options = options;
	}

	apply(compiler) {
		compiler.options.resolve.plugins = compiler.options.resolve.plugins || [];
		compiler.options.resolve.plugins.push(this.newResolverPlugin(this.options, compiler));
		compiler.apply(
			this.newDojoLoaderPlugin(this.options),
			this.newMainTemplatePlugin(this.options),
			this.newChunkTemplatePlugin(this.options),
			this.newModuleFactoryPlugin(this.options)
		);

		compiler.plugin("compilation", this.compilationPlugins.bind(this));
		compiler.plugin("normal-module-factory", this.normalModuleReplacements.bind(this, compiler));

		// Copy options to webpack options
		compiler.options.DojoAMDPlugin = this.options;

		this.setAliases(compiler);
	}

	compilationPlugins(compilation, params) {
		compilation.dependencyFactories.set(DojoAMDRequireItemDependency, params.normalModuleFactory);
		compilation.dependencyTemplates.set(DojoAMDRequireItemDependency, this.newRequireItemDependencyTemplate());

		compilation.dependencyFactories.set(DojoAMDDefineDependency, new NullFactory());
		compilation.dependencyTemplates.set(DojoAMDDefineDependency, this.newDefineDependencyTemplate());

		compilation.dependencyFactories.set(DojoAMDRequireArrayDependency, new NullFactory());
		compilation.dependencyTemplates.set(DojoAMDRequireArrayDependency, this.newRequireArrayDependencyTemplate());

		params.normalModuleFactory.plugin("parser", this.parserPlugins.bind(this));
	}

	parserPlugins(parser) {
		parser.apply(
			this.newRequireDependenciesBlockParserPlugin(this.options),
			this.newDefineDependencyParserPlugin(this.options),
			this.newDojoAMDMiscParserPlugin(this.options)
		);
	}

	normalModuleReplacements(compiler) {
		compiler.apply(	// this === compiler
			new NormalModuleReplacementPlugin(/^dojo\/selector\/_loader!default$/, "dojo/selector/lite"),
			new NormalModuleReplacementPlugin(/^dojo\/request\/default!/, "dojo/request/xhr"),
			new NormalModuleReplacementPlugin(/^dojo\/query!/, data => {
				var match = /^dojo\/query!(.*)$/.exec(data.request);
				data.request = `dojo/loaderProxy?loader=dojo/query&name=${match[1]}&absMid=dojo/query%21${match[1]}!`;
			})
		);
	}

	setAliases(compiler) {
		// Add resolveLoader config entry
		const resolveLoader = compiler.options.resolveLoader = compiler.options.resolveLoader || /* istanbul ignore next */ {};
		const alias = resolveLoader.alias = resolveLoader.alias || /* istanbul ignore next */ {};
		alias['dojo/text'] = path.resolve(__dirname, "..", "loaders", "dojo", "text");
		alias['dojo/i18n'] = path.resolve(__dirname, "..", "loaders", "dojo", "i18n");
		alias['dojo/i18nRootModifier'] = path.resolve(__dirname, "..", "loaders", "dojo", "i18nRootModifier");
		alias['dojo/loaderProxy'] = path.resolve(__dirname, "..", "loaders", "dojo", "loaderProxy");
	}

	// Factories
	newDojoLoaderPlugin(options) {
		return new DojoLoaderPlugin(options);
	}
	newMainTemplatePlugin(options) {
		return new DojoAMDMainTemplatePlugin(options);
	}
	newChunkTemplatePlugin(options) {
		return new DojoAMDChunkTemplatePlugin(options);
	}
	newRequireItemDependencyTemplate() {
		return new DojoAMDRequireItemDependency.Template();
	}
	newDefineDependencyTemplate() {
		return new DojoAMDDefineDependency.Template();
	}
	newRequireArrayDependencyTemplate() {
		return new DojoAMDRequireArrayDependency.Template();
	}
	newModuleFactoryPlugin(options) {
		return new DojoAMDModuleFactoryPlugin(options);
	}
	newResolverPlugin(options, compiler) {
		return new DojoAMDResolverPlugin(options, compiler);
	}
	newRequireDependenciesBlockParserPlugin(options, parser) {
		return new DojoAMDRequireDependenciesBlockParserPlugin(options, parser);
	}
	newDefineDependencyParserPlugin(options, parser) {
		return new DojoAMDDefineDependencyParserPlugin(options, parser);
	}
	newDojoAMDMiscParserPlugin(options, parser) {
		return new DojoAMDMiscParserPlugin(options, parser);
	}
};
module.exports.ScopedRequirePlugin = ScopedRequirePlugin;
