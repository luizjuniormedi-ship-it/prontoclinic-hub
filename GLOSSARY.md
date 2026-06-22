# Glossário — ProntoClinic Hub

> Referência rápida de termos técnicos, regulatórios e de domínio utilizados no projeto.

## Regulatório

- **LGPD**: Lei Geral de Proteção de Dados (Lei 13.709/2018) — regula tratamento de dados pessoais no Brasil.
- **CFM**: Conselho Federal de Medicina — regula exercício da medicina.
- **Resolução CFM 1.821/2007**: regras para prontuário eletrônico (formato, guarda, integridade).
- **Resolução CFM 2.299/2021**: regras para telemedicina e assinatura digital em prontuário.
- **Resolução CFM 2.314/2022**: define a telemedicina como exercício da medicina mediado por tecnologias.
- **ANS**: Agência Nacional de Saúde Suplementar — regula convênios e planos de saúde.
- **ICP-Brasil**: Infraestrutura de Chaves Públicas Brasileira — padrão de assinatura digital com validade jurídica.
- **CBO**: Classificação Brasileira de Ocupações — código de profissão utilizado no TISS.
- **SUS**: Sistema Único de Saúde — sistema público de saúde.
- **DATASUS**: Departamento de Informática do SUS — responsável pelos sistemas de informação do SUS.
- **ANVISA**: Agência Nacional de Vigilância Sanitária — regula serviços de saúde.

## Faturamento

- **TISS**: Troca de Informação em Saúde Suplementar — padrão ANS para troca de dados com convênios.
- **TISS 3.05.00**: versão vigente do padrão (verificar periodicamente no site da ANS).
- **CBHPM**: Classificação Brasileira Hierarquizada de Procedimentos Médicos — tabela de referência para honorários médicos.
- **TUSS**: Terminologia Unificada da Saúde Suplementar — códigos de procedimentos, materiais e medicamentos.
- **BPA**: Boletim de Produção Ambulatorial (SUS) — registro de atendimentos ambulatoriais no SUS.
- **AIH**: Autorização de Internação Hospitalar (SUS) — autorização para internação financiada pelo SUS.
- **SIGTAP**: Sistema de Gerenciamento da Tabela de Procedimentos (SUS).
- **Glosa**: recusa de pagamento por parte da operadora (total ou parcial).
- **Recurso de glosa**: contestação da glosa dentro do prazo previsto pela operadora.
- **Lote TISS**: conjunto de guias enviadas em uma única remessa à operadora.
- **Guia SP/SADT**: guia de solicitação de procedimentos ambulatoriais.
- **Guia de Consulta**: guia de consulta médica.
- **Guia de Internação**: guia para autorização de internação.

## Banco de Dados

- **RLS**: Row Level Security — segurança por linha no PostgreSQL. Filtra SELECT/INSERT/UPDATE/DELETE por linha conforme policy.
- **RPC**: Remote Procedure Call — função executada no banco via chamada HTTP.
- **FK**: Foreign Key (chave estrangeira) — referência de integridade entre tabelas.
- **PK**: Primary Key (chave primária) — identificador único de uma linha.
- **CASCADE**: deletar em cascata — ao remover pai, filhos são removidos automaticamente.
- **SET NULL**: comportamento de FK — ao remover pai, filhos ficam com coluna nula.
- **SECURITY DEFINER**: função roda com permissões do dono, não do chamador.
- **SECURITY INVOKER**: função roda com permissões do chamador.
- **pg_trgm**: extensão PostgreSQL para busca por similaridade (trigrama) — útil em autocompletes.
- **pgcrypto**: extensão PostgreSQL para funções de criptografia (digest, encrypt, etc).
- **GIN**: Generalized Inverted Index — tipo de índice do PostgreSQL.
- **B-tree**: índice padrão do PostgreSQL (ordenado).
- **EXPLAIN ANALYZE**: comando que mostra o plano de execução de uma query.
- **search_path**: schema search path do PostgreSQL — define ordem de resolução de nomes.

## Sistema / Imagens Médicas

- **DICOM**: Digital Imaging and Communications in Medicine — padrão mundial para imagens médicas.
- **PACS**: Picture Archiving and Communication System — sistema de armazenamento e distribuição de imagens médicas.
- **LIS**: Laboratory Information System — sistema de informação laboratorial.
- **RIS**: Radiology Information System — sistema de informação de radiologia.
- **MWL**: Modality Worklist — lista de trabalho modality DICOM (estudos agendados).
- **Orthanc**: PACS open source leve, escrito em C++.
- **OHIF**: Open Health Imaging Foundation — visualizador DICOM web open source.
- **DICOMweb**: API REST para DICOM (WADO-RS, WADO-URI, QIDO-RS, STOW-RS).
- **SOP Instance UID**: identificador único de imagem DICOM.
- **AE Title**: Application Entity Title — identificador DICOM de uma estação/servidor.
- **WADO-RS**: Web Access to DICOM Objects via REST.
- **QIDO-RS**: Query based on ID for DICOM Objects via REST.
- **STOW-RS**: Store Over the Web using REST.
- **Modality Worklist (MWL)**: provê lista de exames agendados para os equipamentos.

## Workflow / Domínio Clínico

- **Triagem**: classificação de risco do paciente na chegada.
- **Manchester**: sistema de triagem por cores (vermelho, laranja, amarelo, verde, azul).
- **NEWS**: National Early Warning Score — escore de deterioração clínica.
- **No-show**: paciente que não compareceu ao agendamento.
- **Encaixe**: agendamento realizado fora dos horários regulares (vaga ociosa).
- **Pré-cadastro**: cadastro inicial de um paciente antes de virar prontuário definitivo.
- **Retorno programado**: consulta de retorno após um tratamento ou procedimento.
- **Lista de espera**: fila de pacientes para vagas ainda não disponíveis.
- **Status de agendamento**: Marcado → Confirmado → Em espera → Em atendimento → Atendido → Faltou → Cancelado.
- **CID-10**: Classificação Internacional de Doenças (10ª revisão) — código de diagnóstico.
- **CID-11**: 11ª revisão, em implantação.
- **CIAP-2**: Classificação Internacional de Atenção Primária (versão 2).
- **Prescrição digital**: receita médica emitida eletronicamente.
- **PEP / EPR**: Prontuário Eletrônico do Paciente.

## Tecnologia

- **PWA**: Progressive Web App — web app instalável no celular.
- **SPA**: Single Page Application — aplicação que roda numa única página HTML.
- **SSR**: Server-Side Rendering — renderização no servidor.
- **SSG**: Static Site Generation — geração estática em build time.
- **CDN**: Content Delivery Network — rede de distribuição de conteúdo.
- **CSP**: Content Security Policy — header HTTP que restringe recursos carregados.
- **HSTS**: HTTP Strict Transport Security — força uso de HTTPS.
- **JWT**: JSON Web Token — token stateless para autenticação.
- **SSO**: Single Sign-On — login único que vale para vários sistemas.
- **SAML 2.0**: padrão de SSO baseado em XML.
- **OIDC**: OpenID Connect — camada de identidade sobre OAuth 2.0.
- **MFA / 2FA**: Autenticação multifator (senha + segundo fator).
- **TOTP**: Time-based One-Time Password (RFC 6238) — segundo fator baseado em tempo.
- **WCAG**: Web Content Accessibility Guidelines.
- **WAI-ARIA**: Accessible Rich Internet Applications — atributos ARIA para acessibilidade.
- **axe-core**: engine de testes de acessibilidade automatizados.
- **DOMPurify**: biblioteca de sanitização de HTML contra XSS.
- **Zod**: biblioteca TypeScript de validação de schemas em runtime.
- **Vite**: bundler / dev server moderno para frontend.
- **Vitest**: framework de testes unitários para Vite.
- **Playwright**: framework de testes E2E multi-browser.
- **PM2**: gerenciador de processos Node.js para produção.
- **Deno**: runtime JavaScript/TypeScript seguro, usado em Edge Functions Supabase.
- **Edge Functions**: funções serverless leves, executadas em CDN.

## Termos do produto

- **Empresa (company)**: tenant raiz. Cada clínica é uma empresa. Isolamento multi-tenant por `company_id`.
- **Unidade**: filial de uma mesma empresa (matriz + filiais).
- **Profissional**: médico ou outro prestador cadastrado em uma empresa.
- **Convênio**: operadora de saúde (Unimed, Amil, SulAmérica, etc).
- **Plano**: produto vendido por uma operadora (básico, executivo, etc).
- **Tabela de preço**: precificação por convênio/plano para cada serviço.
- **Serviço**: procedimento ou consulta (vinculado a código TUSS).
- **DICOM equipment**: aparelho de imagem cadastrado (RX, TC, RM, US).
- **Laudo**: documento médico de resultado de exame.
- **Template de laudo**: modelo com variáveis (`{{paciente.nome}}`) usado para gerar laudos.
- **Pré-cadastro**: registro inicial de paciente via PWA. Vira paciente definitivo após confirmação.
- **Paciente anonimizado**: paciente cujos dados pessoais foram zerados (LGPD).
- **Audit log**: registro imutável de ações sensíveis (CFM 1.821/2007).
- **LGPD solicitação**: pedido formal do titular (exportação, exclusão, correção).
- **Consentimento**: aceite explícito do paciente sobre tratamento de dados.
- **TISS XML**: arquivo XML no padrão TISS enviado à operadora.
- **TISS glosa**: registro de uma glosa retornada pela operadora.