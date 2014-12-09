Config = {
  version: '1.1',
  // Server URL. It might be (depending on the environment):
  //   Development: 'http://loop.dev.mozaws.net'
  //   Stage: 'https://loop.stage.mozaws.net'
  //   Prod: 'https://loop.services.mozilla.com'
  server_url: 'https://loop.services.mozilla.com',
  performanceLog: {
    enabled: true,
    persistent: true
  },
  metrics: {
    enabled: true,
    feedback: {
      serverUrl: 'https://input.allizom.org/api/v1/feedback'
    },
    telemetry: {
      serverUrl: 'https://fxos.telemetry.mozilla.org/submit/telemetry'
    }
  }
};

window.OTProperties = {
  version: 'v2.2.9.1'
};
window.OTProperties.assetURL = '../libs/tokbox/' + window.OTProperties.version + '/';
window.OTProperties.configURL = window.OTProperties.assetURL + 'js/dynamic_config.min.js';
window.OTProperties.cssURL = window.OTProperties.assetURL + 'css/ot.css';
