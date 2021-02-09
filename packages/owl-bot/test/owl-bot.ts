// Copyright 2021 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//      http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

import admin from 'firebase-admin';
import {core} from '../src/core';
import {describe, it, beforeEach} from 'mocha';
import {logger} from 'gcf-utils';
import owlBot from '../src/owl-bot';
// eslint-disable-next-line node/no-extraneous-import
import {Probot, createProbot, ProbotOctokit} from 'probot';
import * as sinon from 'sinon';
import nock from 'nock';

nock.disableNetConnect();
const sandbox = sinon.createSandbox();

describe('owlBot', () => {
  let probot: Probot;
  beforeEach(() => {
    sandbox.stub(process, 'env').value({
      APP_ID: '1234354',
      PROJECT_ID: 'foo-project',
      CLOUD_BUILD_TRIGGER: 'aef1e540-d401-4b85-8127-b72b5993c20d',
    });
    // These two methods are called when the app is first
    // loaded to initialize firestore:
    sandbox.stub(admin, 'initializeApp');
    sandbox.stub(admin, 'firestore');
    probot = createProbot({
      overrides: {
        githubToken: 'abc123',
        Octokit: ProbotOctokit.defaults({
          retry: {enabled: false},
          throttle: {enabled: false},
        }),
      },
    });
    probot.load((app: Probot) => {
      owlBot('abc123', app);
    });
  });
  afterEach(() => {
    sandbox.restore();
  });
  describe('post processing pull request', () => {
    it('returns early and logs if pull request opened from fork', async () => {
      const payload = {
        installation: {
          id: 12345,
        },
        pull_request: {
          head: {
            repo: {
              full_name: 'bcoe/owl-bot-testing',
            },
          },
          base: {
            repo: {
              full_name: 'SurferJeffAtGoogle/owl-bot-testing',
            },
          },
        },
      };
      const loggerStub = sandbox.stub(logger, 'info');
      await probot.receive({name: 'pull_request', payload, id: 'abc123'});
      sandbox.assert.calledWith(
        loggerStub,
        sandbox.match(/.*does not match base.*/)
      );
    });
    it('triggers build if pull request not from fork', async () => {
      const payload = {
        installation: {
          id: 12345,
        },
        pull_request: {
          head: {
            repo: {
              full_name: 'bcoe/owl-bot-testing',
            },
            ref: 'abc123',
          },
          base: {
            repo: {
              full_name: 'bcoe/owl-bot-testing',
            },
          },
        },
      };
      const config = `docker:
      image: node
      digest: sha256:9205bb385656cd196f5303b03983282c95c2dfab041d275465c525b501574e5c`;
      const githubMock = nock('https://api.github.com')
        .get('/repos/bcoe/owl-bot-testing/pulls/')
        .reply(200, payload.pull_request)
        .get(
          '/repos/bcoe/owl-bot-testing/contents/.github%2F.OwlBot.lock.yaml?ref=abc123'
        )
        .reply(200, {
          content: Buffer.from(config).toString('base64'),
          encoding: 'base64',
        });
      const triggerBuildStub = sandbox.stub(core, 'triggerBuild').resolves({
        text: 'the text for check',
        summary: 'summary for check',
        conclusion: 'success',
      });
      const createCheckStub = sandbox.stub(core, 'createCheck');
      await probot.receive({name: 'pull_request', payload, id: 'abc123'});
      sandbox.assert.calledOnce(triggerBuildStub);
      sandbox.assert.calledOnce(createCheckStub);
      githubMock.done();
    });
  });
});
