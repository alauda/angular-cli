/**
 * @license
 * Copyright Google LLC All Rights Reserved.
 *
 * Use of this source code is governed by an MIT-style license that can be
 * found in the LICENSE file at https://angular.io/license
 */

import { BuilderContext, BuilderOutput, createBuilder } from '@angular-devkit/architect';
import rspack from '@rspack/core';
import { resolve as pathResolve } from 'path';
import { Observable, from, isObservable, of, switchMap } from 'rxjs';
import { EmittedFiles, getEmittedFiles, getRSPackConfig } from '../../utils';
import { Schema as RealRSPackBuilderSchema } from './schema';

export type RSPackBuilderSchema = RealRSPackBuilderSchema;

export interface RSPackLoggingCallback {
  (stats: rspack.Stats, config: rspack.Configuration): void;
}
export interface RSPackFactory {
  (config: rspack.Configuration): Observable<rspack.Compiler> | rspack.Compiler;
}

export type BuildResult = BuilderOutput & {
  emittedFiles?: EmittedFiles[];
  rspackStats?: rspack.StatsCompilation;
  outputPath: string;
};

export function runRSPack(
  config: rspack.Configuration,
  context: BuilderContext,
  options: {
    logging?: RSPackLoggingCallback;
    rspackFactory?: RSPackFactory;
    shouldProvideStats?: boolean;
  } = {},
): Observable<BuildResult> {
  const {
    logging: log = (stats, config) => context.logger.info(stats.toString(config.stats)),
    shouldProvideStats = true,
  } = options;
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

  return createRSPack({ ...config, watch: false }).pipe(
    switchMap(
      (rspackCompiler) =>
        new Observable<BuildResult>((obs) => {
          const callback = (err?: Error | null, stats?: rspack.Stats) => {
            if (err) {
              return obs.error(err);
            }

            if (!stats) {
              return;
            }

            // Log stats.
            log(stats, config);

            const statsOptions = typeof config.stats === 'boolean' ? undefined : config.stats;
            const result = {
              success: !stats.hasErrors(),
              rspackStats: shouldProvideStats ? stats.toJson(statsOptions) : undefined,
              emittedFiles: getEmittedFiles(stats.compilation),
              outputPath: stats.compilation.outputOptions.path,
            } as unknown as BuildResult;

            if (config.watch) {
              obs.next(result);
            } else {
              rspackCompiler.close(() => {
                obs.next(result);
                obs.complete();
              });
            }
          };

          try {
            if (config.watch) {
              const watchOptions = config.watchOptions || {};
              const watching = rspackCompiler.watch(watchOptions, callback);

              // Teardown logic. Close the watcher when unsubscribed from.
              return () => {
                watching.close(() => {});
                rspackCompiler.close(() => {});
              };
            } else {
              rspackCompiler.run(callback);
            }
          } catch (err) {
            if (err) {
              context.logger.error(
                `\nAn error occurred during the build:\n${err instanceof Error ? err.stack : err}`,
              );
            }
            throw err;
          }
        }),
    ),
  );
}

export default createBuilder<RSPackBuilderSchema>((options, context) => {
  // webpackConfig from angular.json
  const configPath = pathResolve(context.workspaceRoot, options.webpackConfig);

  return from(getRSPackConfig(configPath)).pipe(switchMap((config) => runRSPack(config, context)));
});
