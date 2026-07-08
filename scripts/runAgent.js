import { runAgentWithSupervision, runFullPipeline } from '../src/agents/ceoAgent.js';

const agentName = process.argv[2];

if (!agentName) {
  console.error('Uso: node scripts/runAgent.js <nome-do-agente>');
  console.error('Agentes disponiveis: prospecting, enrichment, qualification, outreach, conversation, booking, conversion, analytics, report, ceo (corre a pipeline completa)');
  process.exit(1);
}

async function main() {
  try {
    if (agentName === 'ceo') {
      const results = await runFullPipeline();
      console.log(JSON.stringify(results, null, 2));
    } else {
      const result = await runAgentWithSupervision(agentName);
      console.log(JSON.stringify(result, null, 2));
    }
    process.exit(0);
  } catch (err) {
    console.error(`Execucao falhou: ${err.message}`);
    process.exit(1);
  }
}

main();
