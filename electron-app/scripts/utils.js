// @ts-check
'use strict';

// const isElectronPublish = false; // TODO: support auto-updates
export const isNightly = process.env.IS_NIGHTLY === 'true';
export const isRelease = process.env.IS_RELEASE === 'true';
