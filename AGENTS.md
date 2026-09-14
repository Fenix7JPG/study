# BRIEFING PARA EL AGENTE — Spec-Driven Development (GitHub Spec Kit)

> Este archivo es tu instrucción de trabajo. Te entregaron la metodología
> completa de otro agente (Hermes) para que la apliques **tal cual**. Los
> archivos en `skills/` son la fuente de verdad: léalos antes de ejecutar
> cualquier fase. Este briefing explica cuándo aplicar el flujo, en qué orden,
> con qué pausas y con qué reglas de código — es decir, cómo se aplica aquí.

## Archivos entregados

| Archivo | Qué es |
|---|---|
| `skills/spec-driven-development/SKILL.md` | **LEER PRIMERO.** Skill principal: cuándo usar SDD, estado del entorno, flujo de fases, reglas de código del usuario, pitfalls validados en proyectos reales. |
| `skills/spec-driven-development/references/spec-kit-hermes-setup.md` | Log verificado del setup: layout de `.specify/`, fuentes, estadísticas del ecosistema. |
| `skills/speckit-specify/SKILL.md` | Fase 1: crea `.specs/<feature>/spec.md` (requisitos, user stories, criterios de aceptación). |
| `skills/speckit-clarify/SKILL.md` | Fase 1.5 (opt): hasta 5 preguntas dirigidas, respuestas se codifican en el spec. |
| `skills/speckit-constitution/SKILL.md` | Fase 0 (opt): principios del proyecto → `.specify/memory/constitution.md`. |
| `skills/speckit-plan/SKILL.md` | Fase 2: `plan.md` + artefactos de diseño (stack, arquitectura). |
| `skills/speckit-checklist/SKILL.md` | Fase 2.5 (opt): checklist de calidad del feature. |
| `skills/speckit-tasks/SKILL.md` | Fase 3: `tasks.md` ordenado por dependencias. |
| `skills/speckit-analyze/SKILL.md` | Fase 3.5 (opt): reporte de consistencia cruzada spec↔plan↔tasks. |
| `skills/speckit-implement/SKILL.md` | Fase 4: ejecuta `tasks.md` tarea por tarea. |
| `skills/speckit-converge/SKILL.md` | Legacy: evalúa el código contra el spec y agrega trabajo faltante como tareas. |
| `skills/speckit-taskstoissues/SKILL.md` | Export: convierte tasks en issues de GitHub. |

## Cuándo aplicar SDD (disparadores)

- El usuario menciona "spec kit", "speckit", "SDD" o pide desarrollo spec-first.
- El usuario da una idea aproximada (juego, app, feature) y quiere que se construya
  con estructura: spec primero, revisión, luego código.
- Proyecto nuevo, o existente con `.specify/` presente en el directorio del proyecto.

Si el usuario pide SDD a mitad de sesión sobre algo que ya existe, igual aplica:
el spec documenta el estado ACORDADO y congela lo que no cambia.

## Qué es Spec Kit

Toolkit open-source oficial de GitHub para Spec-Driven Development
(https://github.github.com/spec-kit/ · repo `github/spec-kit`). Cada fase produce
un artefacto Markdown que alimenta la siguiente; el agente trabaja desde archivos
estructurados, nunca de prompts ad-hoc. **No inventes requisitos: el spec contiene
solo lo que el usuario dijo o aprobó.**

## Flujo de trabajo EXACTO (cómo se aplica)

### 1. Iniciar el proyecto (si no hay `.specify/`)

```bash
mkdir <proyecto> && cd <proyecto>
specify init . --integration hermes --non-interactive --ignore-agent-tools --force
```

- `specify` CLI v1.0.1, instalado con `uv tool install specify-cli`; suele vivir en
  `~/.local/bin/specify` y NO estar en PATH (en esta PC:
  `C:/Users/USER/.local/bin/specify`). Si no lo encuentras: `uv tool list`.
- En dir no vacío hace falta `--force`. En sesiones no interactivas, si omites
  `--integration` se va a Copilot: SIEMPRE pasa `--integration hermes`.
- **Quirk de Windows CRÍTICO:** init instala las skills en `~/.hermes/skills/`, pero
  el directorio real de skills del agente es otro. Tras CADA init, copia las skills:
  ```bash
  cp -r ~/.hermes/skills/speckit-* <directorio-real-de-skills-del-agente>/
  ```
  (en esta PC: `C:/Users/USER/AppData/Local/hermes/skills/`).
- Tras un init NUEVO aplica la migración de convención: **la carpeta de features es
  `.specs/` (oculta), NO `specs/`** — mover carpeta, reescribir `feature.json` y
  parchear `create-new-feature.ps1` (el CLI lo regenera con `specs/`). Ver Pitfalls.

### 2. Cadena de fases (conversacional; el mensaje del usuario de cada turno es `$ARGUMENTS`)

| Fase | Skill | Produce |
|---|---|---|
| 0 (opt) | speckit-constitution | principios del proyecto |
| 1 | **speckit-specify** | `.specs/<feature>/spec.md` |
| 1.5 (opt) | speckit-clarify | preguntas → respuestas dentro del spec |
| 2 | **speckit-plan** | `plan.md` + artefactos de diseño |
| 2.5 (opt) | speckit-checklist | checklist de calidad |
| 3 | **speckit-tasks** | `tasks.md` por dependencias |
| 3.5 (opt) | **speckit-analyze** | reporte de consistencia |
| 4 | **speckit-implement** | ejecuta las tareas |
| export | speckit-taskstoissues | issues de GitHub |

Para correr una fase: lee el `SKILL.md` de esa fase y síguelo al pie de la letra.

### 3. PAUSAS DE REVISIÓN — OBLIGATORIAS (esto es el corazón del método)

**NO encadenes todas las fases de forma autónoma.** Tras `specify` y tras `plan`
DETENTE y pide al usuario revisar y aprobar. Corregir el spec/plan ANTES de codificar
es el punto entero del SDD. En ciclos validados se hicieron 3–4 pausas (post-spec,
post-plan, post-tasks, post-analyze) y el usuario añadió requisitos nuevos en ellas:
cuando eso pase, integra con un patch al spec (user story + FR + edge + criterio +
entidades) y re-recorre mentalmente el checklist.

### 4. Ruta completa vs ruta ligera

- **Feature mecánico nuevo** → ruta completa: specify → plan → tasks → analyze → implement.
- **Refactor de presentación/contenido donde la mecánica no cambia** → ruta ligera:
  specify → checklist → implement directo (sin plan ni tasks; serían burocracia).
  El spec debe incluir un FR que CONGELA lo que no cambia, del estilo:
  "Toda la mecánica previa se conserva: …" (enumera reglas, inmunidades, rangos, IA).
  Esto evita que el refactor rompa reglas acordadas.

### 5. Spec-first para ambigüedades

Si una regla es ambigua, aclárala con `clarify` (opciones + implicaciones de cada una)
ANTES de codificar, e integra la respuesta como FR preciso. Máx 3 marcadores
`[NEEDS CLARIFICATION]` en un spec; prioriza scope > seguridad > UX > detalle técnico.

### 6. Analyze antes de implement — siempre que exista tasks.md

`speckit-analyze` es barato y encuentra issues reales (validado: FR sin tarea que lo
implemente, criterios vagos → hacerlos medibles con config explícita). Aplica la
remediación ANTES de `speckit-implement`.

### 7. Implement

- Ejecuta `tasks.md` tarea por tarea, en orden.
- El checklist de implement exige `checklists/` 100% `[x]`: si `requirements.md`
  quedó con items vacíos, la implement se detiene a preguntar. No los dejes vacíos.
- Tamaño manejable por ciclo: ~35–40 tareas (setup + foundational + stories + polish).
  `foundational` suele ser ~45% del esfuerzo.

## Reglas de código del usuario — OBLIGATORIAS en la fase implement

- Python: sin `%`-format ni f-strings → `print('a', var)` y concatenación `+ str()`.
- Sin comprensiones de listas/dicts: bucles simples.
- Separar interfaz de la lógica (módulos distintos).
- Sin guard `if __name__ == '__main__'`: cerrar el archivo con llamada directa a `main()`.
- Comentarios en español que expliquen cada sección y cada acción del flujo.
- venv DENTRO del proyecto.
- Pygame: patrón MVC (modelo / vista / controlador separados).
- Las plantillas de spec-kit pueden traer ejemplos con f-strings: la regla del
  usuario SIEMPRE gana para el código que escribas.

## Pitfalls validados (leídos de proyectos reales — no los redescubras)

1. `setup-tasks.ps1` NO copia el template a disco (a diferencia de `setup-plan.ps1`):
   devuelve `TASKS_TEMPLATE_CONTENT` inline en el JSON → escribe `tasks.md` a mano
   con ese contenido. No esperes un tasks.md generado.
2. `specify integration list` falla fuera de un proyecto root (necesita `.specify/`).
3. La carpeta de features es **`.specs/`** (oculta), NO `specs/`. El `spec.md`
   interno no cambia. Tras un `specify init` nuevo, migrar de inmediato (3 pasos:
   mover carpeta, reescribir `feature.json`, parchear el ps1). Si un proyecto viejo
   aún tiene `specs/`, migra antes de correr fases.
4. Ediciones sobre código generado con `patch` multi-bloque pueden borrar líneas
   adyacentes (fuzzy match agresivo): si pasa, re-crea el archivo completo con
   write (no insistas con patch).
5. **Verificación post-implement obligatoria**: no confíes en autoreportes
   ("ya quedó"); verifica ejecutando. En un ciclo esto cazó un bug real que el spec
   no preveía (identidad del bando deducida del nombre rompe en duelos espejo).
   Regla para juegos 1v1: la identidad del bando NUNCA se deduce del nombre.
6. Si el proyecto se movió de carpeta: `.specify/`/`.specs/` se quedaron atrás →
   re-init con `--force` en la carpeta nueva; el feature numera siguiente. Verifica
   siempre `ls .specify/templates/` antes de asumir que el proyecto sigue ahí.
7. Cada juego/idea = su propio proyecto speckit (propio `.specify/`); no anides
   features entre juegos.
8. Generación masiva de archivos (~400 ficheros) con subagentes: escribe el BRIEF a
   un archivo y pasa a cada subagente un contexto CORTO apuntando al archivo (los
   contextos enormes hacen timeout). Antes de relanzar tras un fallo aparente,
   lista los subagentes vivos: reintentar a ciegas crea DUPLICADOS. Los subagentes
   mueren por timeout o escriben en rutas equivocadas: inventaría el filesystem real
   para verificar qué se escribió y dónde.

## Verificación final (siempre)

Nunca declare terminada una tarea sin haber ejecutado lo escrito:
corre el programa/tests, verifica conteos y salidas reales. Tras implement,
re-lee el spec y confirma cada criterio de éxito contra el comportamiento real.

## Nota sobre rutas

Los `SKILL.md` entregados mencionan rutas de la PC de origen (`C:/Users/USER/...`).
Si trabajas en esta misma PC son válidos. Si trabajas en otra máquina, localiza
`specify` con `uv tool list` / `uv tool run specify --help` y adapta las rutas de
skills al directorio de skills de tu agente. Nada del flujo depende de esas rutas:
dependen de `.specify/` dentro del proyecto y de los archivos `skills/` entregados.
