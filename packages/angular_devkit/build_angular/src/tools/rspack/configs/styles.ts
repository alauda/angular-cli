/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import type { Configuration, LoaderContext } from 'webpack';
import { WebpackConfigOptions } from '../../../utils/build-options';
import { PostcssCliResources } from '../plugins';
import { assetNameTemplateFactory, getOutputHashFormat } from '../utils/helpers';

// eslint-disable-next-line max-lines-per-function
export async function getStylesConfig(wco: WebpackConfigOptions): Promise<Configuration> {
  const { buildOptions, logger } = wco;

  const cssSourceMap = buildOptions.sourceMap.styles;

  // Determine hashing format.
  const hashFormat = getOutputHashFormat(buildOptions.outputHashing);

  const assetNameTemplate = assetNameTemplateFactory(hashFormat);

  const extraPostcssPlugins: import('postcss').Plugin[] = [];

  const autoprefixer: typeof import('autoprefixer') = require('autoprefixer');

  const postcssOptionsCreator = (inlineSourcemaps: boolean, extracted: boolean) => {
    const optionGenerator = (loader: LoaderContext<unknown>) => ({
      map: inlineSourcemaps
        ? {
            inline: true,
            annotation: false,
          }
        : undefined,
      plugins: [
        PostcssCliResources({
          baseHref: buildOptions.baseHref,
          deployUrl: buildOptions.deployUrl,
          resourcesOutputPath: buildOptions.resourcesOutputPath,
          loader,
          filename: assetNameTemplate,
          emitFile: buildOptions.platform !== 'server',
          extracted,
        }),
        ...extraPostcssPlugins,
        autoprefixer({
          ignoreUnknownVersions: true,
          overrideBrowserslist: buildOptions.supportedBrowsers,
        }),
      ],
    });
    // postcss-loader fails when trying to determine configuration files for data URIs
    optionGenerator.config = false;

    return optionGenerator;
  };

  let componentsSourceMap = !!cssSourceMap;
  if (cssSourceMap) {
    if (buildOptions.optimization.styles.minify) {
      // Never use component css sourcemap when style optimizations are on.
      // It will just increase bundle size without offering good debug experience.
      logger.warn(
        'Components styles sourcemaps are not generated when styles optimization is enabled.',
      );
      componentsSourceMap = false;
    } else if (buildOptions.sourceMap.hidden) {
      // Inline all sourcemap types except hidden ones, which are the same as no sourcemaps
      // for component css.
      logger.warn('Components styles sourcemaps are not generated when sourcemaps are hidden.');
      componentsSourceMap = false;
    }
  }

  return {
    module: {
      rules: [
        {
          test: /\.css$/i,
          type: 'asset/source',
          rules: [
            // {
            //   loader: 'css-loader',
            // },
            // {
            //   loader: 'postcss-loader',
            //   options: {
            //     postcssOptions: postcssOptionsCreator(false, true),
            //     sourceMap: !!cssSourceMap,
            //   },
            // },
          ],
        },
      ],
    },
  };
}
