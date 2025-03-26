const express = require('express');
const serverless = require('serverless-http');
const app = require('../../dist/server').default;

module.exports.handler = serverless(app);
