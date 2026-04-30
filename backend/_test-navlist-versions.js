require('dotenv').config();
const m = require('./services/metaCloud');

(async () => {
  for (const ver of ['3.0', '3.1', '7.0', '7.1', '7.2', '7.3']) {
    const json = {
      version: '7.3',
      data_api_version: ver,
      routing_model: { TEST: [] },
      screens: [{
        id: 'TEST',
        title: 'T',
        data: { flow_token: { type: 'string', __example__: 't' } },
        layout: {
          type: 'SingleColumnLayout',
          children: [
            {
              type: 'NavigationList',
              name: 'lst',
              'list-items': [{
                id: 'a',
                'main-content': { title: 'A' },
                'on-click-action': { name: 'data_exchange', payload: { flow_token: '${data.flow_token}' } }
              }]
            },
            { type: 'Footer', label: 'OK', 'on-click-action': { name: 'data_exchange', payload: { flow_token: '${data.flow_token}' } } }
          ]
        }
      }]
    };
    try {
      const r = await m.updateFlowJSON(process.env.WHATSAPP_ORDER_ACTIONS_FLOW_ID, json);
      console.log(`${ver} ->`, JSON.stringify((r.validation_errors || []).map(e => e.message)));
    } catch (e) {
      console.error(`${ver} ERR`, JSON.stringify(e.response?.data || e.message));
    }
  }
})();
