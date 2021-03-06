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

/*
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 * ATTENTION!!! If you make changes to this file that affect the generated code,
 * be sure to update the hash generation function at the end of the file.
 * !!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!!
 */

const {plugin} = require("./pluginHelper");
const ConcatSource = require("webpack-sources").ConcatSource;

module.exports = class DojoAMDChunkTemplatePlugin {
	apply(compiler) {
		this.compiler = compiler;
		compiler.plugin("compilation", (compilation, params) => {
			const context = Object.create(this, {
				compilation:{value: compilation},
				params:{value:params}
			});
			plugin(compilation.chunkTemplate, {
				"render"         : this.render,
				"render absMids" : this.renderAbsMids,
				"hash"           : this.hash
			}, context);
		});
	}

	render(source, chunk) {
		const chunkTemplate = this.compilation.chunkTemplate;
		const jsonpFunction = chunkTemplate.outputOptions.jsonpFunction;
		const buf = [];
		buf.push(jsonpFunction + ".registerAbsMids({");
		buf.push(chunkTemplate.applyPluginsWaterfall("render absMids", "", chunk));
		buf.push("});");
		buf.push("");
		const replacementSource = new ConcatSource();
		replacementSource.add(chunkTemplate.asString(buf));
		replacementSource.add(source);
		return replacementSource;
	}

	renderAbsMids(source, chunk) {
		const chunkTemplate = this.compilation.chunkTemplate;
		var modules = chunk.getModules ? chunk.getModules() : /* istanbul ignore next */ chunk.modules;
		const buf = [], renderedAbsMids = {};
		var lastEntry;
		const renderAbsMid = function(absMid, mod) {
			if (!renderedAbsMids.hasOwnProperty(absMid)) {
				if (lastEntry >= 0) {
					buf[lastEntry] += ",";
				}
				buf.push(chunkTemplate.indent(`'${absMid}':${JSON.stringify(mod.id)}`));
				lastEntry = buf.length-1;
				renderedAbsMids[absMid] = mod;
			} else if (renderedAbsMids[absMid] !== mod) {
				throw new Error(`Duplicate absMid (${absMid}) for modules ${renderedAbsMids[absMid].request} and ${mod.request}`);
			}
		}.bind(this);

		modules.forEach((module) => {
			if (module.absMid) {
				renderAbsMid(module.absMid, module);
				(module.absMidAliases||[]).forEach((alias) => {
					renderAbsMid(alias, module);
				});
			} else {
				buf.push(chunkTemplate.indent(`// ${module.rawRequest} = ${JSON.stringify(module.id)}`));
			}
		});
		return source + chunkTemplate.asString(buf);
	}

	hash(hash) {
		hash.update("DojoAMDChunkTemplate");
		hash.update("2");		// Increment this whenever the template code above changes
	}
};
