/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import { BuilderContext, createBuilder } from '@angular-devkit/architect';
import rspack from '@rspack/core';
import DevServer, { Configuration, RspackDevServer } from '@rspack/dev-server';
import { resolve as pathResolve } from 'path';
import { Observable, from, isObservable, of, switchMap } from 'rxjs';
import { getEmittedFiles, getRSPackConfig } from '../../utils';
import { BuildResult, RSPackFactory, RSPackLoggingCallback } from '../webpack';
import { Schema as RSPackDevServerBuilderSchema } from './schema';

export type DevServerFactory = typeof RspackDevServer;

export type DevServerBuildOutput = BuildResult & {
  port: number;
  family: string;
  address: string;
};

export function runDevServer(
  config: rspack.Configuration,
  context: BuilderContext,
  options: {
    shouldProvideStats?: boolean;
    devServerConfig?: Configuration;
    logging?: RSPackLoggingCallback;
    rspackFactory?: RSPackFactory;
    devServerFactory?: DevServerFactory;
  } = {},
): Observable<DevServerBuildOutput> {
  const createRSPack = (c: rspack.Configuration) => {
    if (options.rspackFactory) {
      const result = options.rspackFactory(c);
      if (isObservable(result)) {
        return result;
      } else {
        return of(result);
      }
    } else {
      return of(rspack.rspack(c));
    }
  };

  const createDevServer = (
    rspack: rspack.Compiler | rspack.MultiCompiler,
    config: DevServer.Configuration,
  ) => {
    if (options.devServerFactory) {
      return new options.devServerFactory(config, rspack);
    }

    return new RspackDevServer(config, rspack);
  };

  const log: RSPackLoggingCallback =
    options.logging || ((stats, config) => context.logger.info(stats.toString(config.stats)));

  const shouldProvideStats = options.shouldProvideStats ?? true;

  return createRSPack({ ...config, watch: false }).pipe(
    switchMap(
      (compiler) =>
        new Observable<DevServerBuildOutput>((obs) => {
          const devServerConfig = options.devServerConfig || config.devServer || {};
          // devServerConfig.host ??= 'localhost';

          let result: Partial<DevServerBuildOutput>;

          const statsOptions = typeof config.stats === 'boolean' ? undefined : config.stats;

          compiler.hooks.done.tap('build-webpack', (stats) => {
            // Log stats.
            log(stats, config);
            obs.next({
              ...result,
              webpackStats: shouldProvideStats ? stats.toJson(statsOptions) : undefined,
              emittedFiles: getEmittedFiles(stats.compilation),
              success: !stats.hasErrors(),
              outputPath: stats.compilation.outputOptions.path,
            } as unknown as DevServerBuildOutput);
          });

          const devServer = createDevServer(compiler, devServerConfig);
          devServer.startCallback((err) => {
            if (err) {
              obs.error(err);

              return;
            }

            const address = devServer.server?.address();
            if (!address) {
              obs.error(new Error(`Dev-server address info is not defined.`));

              return;
            }

            result = {
              success: true,
              port: typeof address === 'string' ? 0 : address.port,
              family: typeof address === 'string' ? '' : address.family,
              address: typeof address === 'string' ? address : address.address,
            };
          });

          // Teardown logic. Close the server when unsubscribed from.
          return () => {
            devServer.stopCallback(() => {});
            compiler.close(() => {});
          };
        }),
    ),
  );
}

export default createBuilder<RSPackDevServerBuilderSchema, DevServerBuildOutput>(
  (options, context) => {
    const configPath = pathResolve(context.workspaceRoot, options.webpackConfig);

    return from(getRSPackConfig(configPath)).pipe(
      switchMap((config) => runDevServer(config, context)),
    );
  },
);
