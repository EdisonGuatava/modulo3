# 🔄 **FLUJO DETALLADO DEL ORQUESTADOR**

## **📖 Índice**
1. [Introducción](#introducción)
2. [Arquitectura General](#arquitectura-general)
3. [Análisis del Código por Fases](#análisis-del-código-por-fases)
4. [Funciones de Soporte](#funciones-de-soporte)
5. [Ejemplos Prácticos](#ejemplos-prácticos)
6. [Características Clave](#características-clave)

---

## **🎯 Introducción**

El orquestador es el **núcleo del sistema resiliente** que implementa un patrón de **Circuit Breaker con evaluación retrospectiva**. Su función principal es determinar el nivel de servicio (1, 2, 3) basándose en el análisis de errores de minutos anteriores y dirigir las peticiones a las Lambdas correspondientes.

### **🏗️ Componentes Principales:**
- **Evaluación Retrospectiva:** Analiza errores del minuto anterior (completo)
- **Degradación Progresiva:** Transiciones 1→2→3 basadas en umbrales
- **Recuperación Gradual:** Transiciones 3→2→1 paso a paso
- **Persistencia de Estado:** DynamoDB para mantener histórico
- **Invocación de Servicios:** Lambdas especializadas por nivel

---

## **🏛️ Arquitectura General**

```mermaid
graph TD
    A[Petición HTTP] --> B[Orquestador]
    B --> C{Evaluar Nivel}
    C -->|Nivel 1| D[Full Service Lambda]
    C -->|Nivel 2| E[Degraded Service Lambda]
    C -->|Nivel 3| F[Minimal Service Lambda]
    
    B --> G[DynamoDB State]
    G --> B
    
    D --> H[Respuesta: "Nivel 1: Ok/Error"]
    E --> I[Respuesta: "Nivel 2: Ok/Limitada"]
    F --> J[Respuesta: "Nivel 3: Mínimo/Mantenimiento"]
```

---

## **🔍 Análisis del Código por Fases**

### **🚀 FASE 1: Inicialización y Configuración**

```javascript
const AWS = require('aws-sdk');
const dynamo = new AWS.DynamoDB.DocumentClient();
const lambda = new AWS.Lambda();

const SYSTEM_ID = 'main';
const TABLE_NAME = process.env.DYNAMODB_TABLE || 'SystemState';
```

**📝 Explicación:**
- **AWS SDK:** Configura clientes para DynamoDB (estado) y Lambda (invocaciones)
- **SYSTEM_ID:** Permite múltiples sistemas en la misma tabla DynamoDB
- **TABLE_NAME:** Tabla de estado con fallback para desarrollo local

**🎯 Propósito:** Establece las conexiones fundamentales con los servicios AWS necesarios.

---

### **🎯 FASE 2: Procesamiento de la Petición**

```javascript
exports.handler = async (event) => {
    try {
        console.log('Orchestrator - Evento recibido:', JSON.stringify(event, null, 2));
        
        // Parsear el body de la petición
        let body;
        try {
            body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
        } catch (e) {
            body = {};
        }
        
        const isError = body.error === true;
        const currentTime = Date.now();
```

**📝 Explicación:**
- **Event Parsing:** Normaliza el payload desde API Gateway (string o objeto)
- **Error Detection:** Identifica si la petición representa un error del sistema
- **Timestamp:** Captura el momento exacto de procesamiento

**🔑 Sentencia Clave:**
```javascript
body = typeof event.body === 'string' ? JSON.parse(event.body) : event.body;
```
**Maneja la inconsistencia de API Gateway** que puede enviar el body como string o objeto.

---

### **⏰ FASE 3: Cálculo Temporal Exacto (Sin Math.floor)**

```javascript
const date = new Date(currentTime);
const currentMinute = date.getTime() - (date.getTime() % 60000); // Minuto exacto en timestamp
const previousMinute = currentMinute - 60000; // Exactamente 1 minuto atrás

// Para debug: mostrar tiempo real
console.log(`Tiempo real: ${date.toISOString()}, Current minute timestamp: ${currentMinute}, Previous minute timestamp: ${previousMinute}`);
```

**📝 Explicación Crítica:**
- **`date.getTime() % 60000`:** Obtiene milisegundos dentro del minuto actual
- **Al restarlo del timestamp total:** Obtiene el timestamp exacto del inicio del minuto
- **`previousMinute = currentMinute - 60000`:** Exactamente 1 minuto (60,000ms) atrás

**❌ Por qué NO usamos Math.floor:**
- `Math.floor(date.getTime() / 60000)` genera números enteros que pueden causar problemas de sincronización
- El enfoque de timestamp permite cálculos precisos y comparaciones exactas

**💡 Ejemplo:**
```
Tiempo real: 14:23:45.123
currentMinute  = 1693737780000 (timestamp de 14:23:00.000)
previousMinute = 1693737720000 (timestamp de 14:22:00.000)
```

---

### **💾 FASE 4: Lectura del Estado Persistente**

```javascript
// Leer estado actual del sistema
const state = await getSystemState();
let { errorsByMinute = {}, currentLevel = 1, lastCheckedMinute = currentMinute - 60000 } = state;
```

**📝 Explicación:**
- **getSystemState():** Función asíncrona que lee desde DynamoDB
- **Destructuring con defaults:** Si no existe estado previo, inicializa valores seguros
- **errorsByMinute:** Objeto que mapea `timestamp → conteo_errores`
- **currentLevel:** Nivel actual del sistema (1=pleno, 2=degradado, 3=mínimo)
- **lastCheckedMinute:** Último timestamp donde se evaluó el nivel

**🔑 Estructura de errorsByMinute:**
```javascript
{
  "1693737720000": 3,  // 3 errores en minuto 14:22
  "1693737780000": 7,  // 7 errores en minuto 14:23
  "1693737840000": 1   // 1 error en minuto 14:24
}
```

---

### **📊 FASE 5: Registro de Errores**

```javascript
// Registrar error si viene marcado como error en el minuto actual
if (isError) {
    if (!errorsByMinute[currentMinute]) {
        errorsByMinute[currentMinute] = 0;
    }
    errorsByMinute[currentMinute]++;
    console.log(`Error registrado en timestamp ${currentMinute}. Total errores en este minuto: ${errorsByMinute[currentMinute]}`);
}
```

**📝 Explicación:**
- **Conteo Incremental:** Solo cuenta errores, no peticiones exitosas
- **Inicialización Segura:** Crea el contador si es la primera vez en este minuto
- **Agrupación Temporal:** Todos los errores del mismo minuto se agrupan

**🎯 Propósito:** Acumula evidencia de problemas sin afectar inmediatamente el nivel de servicio.

---

### **🔄 FASE 6: Evaluación Retrospectiva (NÚCLEO DEL ALGORITMO)**

```javascript
// Determinar nivel de servicio basado en errores del minuto anterior
let level = currentLevel;
const previousLevel = level;

// Solo recalcular nivel si cambiamos de minuto timestamp
if (currentMinute > lastCheckedMinute) {
    const errorsInPreviousMinute = errorsByMinute[previousMinute] || 0;
    console.log(`=== CAMBIO DE MINUTO ===`);
    console.log(`Minuto anterior (timestamp ${previousMinute}): ${errorsInPreviousMinute} errores`);
    console.log(`Nivel actual: ${currentLevel}`);
```

#### **🔑 Condición Crítica de Evaluación:**
```javascript
if (currentMinute > lastCheckedMinute) {
```
**📝 Explicación:** **Trigger de evaluación retrospectiva**
- Solo evalúa cuando ha pasado a un **nuevo minuto**
- Evita re-evaluaciones constantes durante el mismo minuto
- Garantiza que cada minuto se evalúe **exactamente una vez**

#### **🎯 Obtención de Datos Históricos:**
```javascript
const errorsInPreviousMinute = errorsByMinute[previousMinute] || 0;
```
**📝 Explicación:** **Lookup retrospectivo**
- Busca errores del minuto que **ya terminó completamente**
- Usa datos **finales y completos**, no parciales
- El `|| 0` maneja el caso donde no hubo errores

#### **🚨 Algoritmo de Degradación:**
```javascript
// Lógica de transición basada en errores del minuto anterior
if (errorsInPreviousMinute >= 10) {
    level = 3;  // Nivel mínimo
} else if (errorsInPreviousMinute >= 5) {
    level = 2;  // Nivel degradado
} else {
    // Si no hay errores suficientes, recuperación gradual
    if (currentLevel === 3) {
        level = 2; // De nivel 3 a nivel 2
        console.log(`Recuperación gradual: 3 → 2`);
    } else if (currentLevel === 2) {
        level = 1; // De nivel 2 a nivel 1
        console.log(`Recuperación gradual: 2 → 1`);
    } else {
        level = 1; // Mantener nivel 1
    }
}
```

**📝 Explicación del Circuit Breaker:**

| Errores en Minuto Anterior | Acción | Razón |
|---|---|---|
| **≥ 10 errores** | Degrada a Nivel 3 | Sistema severamente comprometido |
| **≥ 5 errores** | Degrada a Nivel 2 | Problemas moderados detectados |
| **< 5 errores** | Recuperación gradual | Sistema estabilizándose |

**🔄 Recuperación Gradual:**
- **3 → 2 → 1:** Evita saltos bruscos que podrían desestabilizar
- **Permite adaptación:** El sistema se recupera paso a paso
- **Previene oscilaciones:** No hay cambios drásticos

#### **📝 Logging de Transiciones:**
```javascript
// Log de transición si cambia el nivel
if (level !== previousLevel) {
    console.log(`🔄 TRANSICIÓN: Nivel ${previousLevel} → ${level}. Errores minuto anterior: ${errorsInPreviousMinute}`);
} else {
    console.log(`⏸️ SIN CAMBIO: Nivel ${level}. Errores minuto anterior: ${errorsInPreviousMinute}`);
}

lastCheckedMinute = currentMinute;
```

**📝 Explicación:**
- **Tracking de cambios:** Registra todas las transiciones para debugging
- **Estado actualizado:** `lastCheckedMinute` previene re-evaluaciones
- **Observabilidad:** Logs detallados para análisis posterior

---

### **🧹 FASE 7: Limpieza de Datos Antiguos**

```javascript
// Limpiar errores de minutos muy antiguos (mantener solo últimos 10 minutos)
const cutoffTimestamp = currentMinute - (10 * 60000); // 10 minutos atrás
Object.keys(errorsByMinute).forEach(timestamp => {
    if (parseInt(timestamp) < cutoffTimestamp) {
        delete errorsByMinute[timestamp];
    }
});
```

**📝 Explicación:**
- **Garbage Collection:** Elimina datos históricos irrelevantes
- **Optimización de memoria:** Previene crecimiento infinito del estado
- **Ventana deslizante:** Mantiene solo 10 minutos de historia

**🎯 Beneficios:**
- **Performance:** Operaciones más rápidas con menos datos
- **Costo:** Menor uso de almacenamiento en DynamoDB
- **Simplicidad:** Estado manejable y relevante

---

### **💾 FASE 8: Persistencia del Estado**

```javascript
// Guardar nuevo estado
await saveSystemState(errorsByMinute, level, lastCheckedMinute);
```

**📝 Explicación:**
- **Persistencia asíncrona:** Guarda el estado actualizado en DynamoDB
- **Consistencia:** Mantiene estado entre invocaciones de Lambda
- **Durabilidad:** Sobrevive a reinicios y fallos temporales

---

### **📦 FASE 9: Preparación del Payload para Lambdas**

```javascript
// Preparar payload para las Lambdas
const errorsInCurrentMinute = errorsByMinute[currentMinute] || 0;
const payload = {
    body: body,
    level: level,
    errorCount: errorsInCurrentMinute,
    isError: isError,
    currentMinute: currentMinute,
    previousMinute: previousMinute,
    errorsInPreviousMinute: errorsByMinute[previousMinute] || 0
};
```

**📝 Explicación:**
- **Contexto completo:** Proporciona toda la información relevante a las Lambdas
- **Decisiones informadas:** Las Lambdas pueden usar este contexto para lógica específica
- **Debugging:** Información completa para troubleshooting

**🔑 Campos del Payload:**
- **body:** Datos originales de la petición
- **level:** Nivel determinado (1, 2, 3)
- **errorCount:** Errores acumulados en minuto actual
- **isError:** Si esta petición específica es un error
- **currentMinute/previousMinute:** Timestamps para contexto temporal
- **errorsInPreviousMinute:** Datos que influyeron en la decisión

---

### **🎯 FASE 10: Invocación de Lambdas**

```javascript
// Invocar Lambda correspondiente según el nivel
let lambdaResponse;
switch (level) {
    case 1:
        lambdaResponse = await invokeLambda(process.env.FULL_SERVICE_LAMBDA, payload);
        break;
    case 2:
        lambdaResponse = await invokeLambda(process.env.DEGRADED_SERVICE_LAMBDA, payload);
        break;
    case 3:
        lambdaResponse = await invokeLambda(process.env.MINIMAL_SERVICE_LAMBDA, payload);
        break;
    default:
        lambdaResponse = { nivel: 1, mensaje: 'Servicio por defecto' };
}
```

**📝 Explicación:**
- **Invocación condicional:** Según el nivel determinado por evaluación retrospectiva
- **Variables de entorno:** Referencias a las Lambdas específicas
- **Fallback seguro:** Default en caso de configuración incorrecta

**🎯 Distribución por Nivel:**
- **Nivel 1 → Full Service:** Todas las funcionalidades disponibles
- **Nivel 2 → Degraded Service:** Funcionalidades esenciales únicamente
- **Nivel 3 → Minimal Service:** Operación mínima o mantenimiento

---

### **📤 FASE 11: Construcción de Respuesta**

```javascript
// Generar respuesta usando solo el mensaje de la Lambda invocada
let response;
if (lambdaResponse && lambdaResponse.mensaje) {
    response = {
        message: lambdaResponse.mensaje
    };
} else {
    // Fallback si la Lambda no responde correctamente
    switch (level) {
        case 1:
            response = {
                message: isError ? "Nivel 1: Operación full con error" : "Nivel 1: Ok"
            };
            break;
        case 2:
            response = {
                message: isError ? "Nivel 2: Operación límitada" : "Nivel 2: Ok"
            };
            break;
        case 3:
            response = {
                message: isError ? "Nivel 3: Sistema bajo mantenimiento, intente más tarde" : "Nivel 3: Operación al mínimo"
            };
            break;
        default:
            response = {
                message: "Nivel 1: Ok"
            };
    }
}
```

**📝 Explicación:**
- **Respuesta simplificada:** Solo el mensaje esencial para el cliente
- **Fallback robusto:** Mensajes por defecto si las Lambdas fallan
- **Formato consistente:** Siempre `{"message": "..."}`

**🔑 Estrategia de Respuesta:**
1. **Preferencia:** Mensaje directo de la Lambda invocada
2. **Fallback:** Mensaje generado basado en nivel y estado de error
3. **Garantía:** Siempre retorna una respuesta válida

---

## **🔒 Funciones de Soporte Críticas**

### **💾 getSystemState()**

```javascript
async function getSystemState() {
    try {
        const result = await dynamo.get({
            TableName: TABLE_NAME,
            Key: { systemId: SYSTEM_ID }
        }).promise();
        
        return result.Item || { 
            errorsByMinute: {}, 
            currentLevel: 1, 
            lastCheckedMinute: Date.now() - (Date.now() % 60000) - 60000 
        };
    } catch (error) {
        console.error('Error leyendo estado del sistema:', error);
        return { 
            errorsByMinute: {}, 
            currentLevel: 1, 
            lastCheckedMinute: Date.now() - (Date.now() % 60000) - 60000 
        };
    }
}
```

**📝 Explicación:**
- **Lectura atómica:** Una sola operación DynamoDB
- **Inicialización segura:** Valores por defecto si no existe estado previo
- **Manejo de errores:** Fallback graceful en caso de problemas de red

### **💾 saveSystemState()**

```javascript
async function saveSystemState(errorsByMinute, level, lastCheckedMinute) {
    try {
        await dynamo.put({
            TableName: TABLE_NAME,
            Item: {
                systemId: SYSTEM_ID,
                errorsByMinute: errorsByMinute,
                currentLevel: level,
                lastCheckedMinute: lastCheckedMinute,
                lastUpdated: Date.now()
            }
        }).promise();
        
        console.log('Estado guardado:', {
            level: level,
            lastCheckedMinute: lastCheckedMinute,
            errorsByMinute: Object.keys(errorsByMinute).length + ' minutos con datos'
        });
    } catch (error) {
        console.error('Error guardando estado del sistema:', error);
    }
}
```

**📝 Explicación:**
- **Persistencia atómica:** Todo el estado se guarda en una operación
- **Timestamp de actualización:** Para debugging y auditoría
- **Logging descriptivo:** Información resumida del estado guardado

### **🚀 invokeLambda()**

```javascript
async function invokeLambda(functionName, payload) {
    try {
        const result = await lambda.invoke({
            FunctionName: functionName,
            InvocationType: 'RequestResponse',
            Payload: JSON.stringify(payload)
        }).promise();
        
        return JSON.parse(result.Payload);
    } catch (error) {
        console.error(`Error invocando Lambda ${functionName}:`, error);
        return {
            nivel: 3,
            mensaje: 'Error invocando servicio',
            error: error.message
        };
    }
}
```

**📝 Explicación:**
- **Invocación síncrona:** `RequestResponse` espera la respuesta
- **Serialización:** Convierte payload a JSON para transmisión
- **Manejo de errores:** Retorna respuesta de nivel 3 en caso de fallo

---

## **📋 Ejemplos Prácticos**

### **Ejemplo 1: Degradación por Errores**

**Situación:** Sistema funcionando en Nivel 1, comienzan a llegar errores

| Tiempo | Minuto | Errores | Nivel Resultante | Acción |
|---|---|---|---|---|
| 14:22:30 | 14:22 | 3 errores | Nivel 1 | Mantiene (< 5 errores) |
| 14:23:15 | 14:23 | 7 errores | Nivel 2 | Degrada (≥ 5 errores en 14:22) |
| 14:24:05 | 14:24 | 12 errores | Nivel 3 | Degrada (≥ 10 errores en 14:23) |

### **Ejemplo 2: Recuperación Gradual**

**Situación:** Sistema en Nivel 3, errores disminuyen

| Tiempo | Minuto | Errores | Nivel Resultante | Acción |
|---|---|---|---|---|
| 14:25:10 | 14:25 | 2 errores | Nivel 2 | Recupera gradualmente (3→2) |
| 14:26:20 | 14:26 | 1 error | Nivel 1 | Recupera gradualmente (2→1) |
| 14:27:30 | 14:27 | 0 errores | Nivel 1 | Mantiene |

### **Ejemplo 3: Respuestas según Lambda**

**Petición con error en Nivel 2:**
```json
Input: {"error": true, "data": "test"}
Lambda Response: {"nivel": 2, "mensaje": "Nivel 2: Operación límitada", ...}
Final Response: {"message": "Nivel 2: Operación límitada"}
```

**Petición exitosa en Nivel 1:**
```json
Input: {"data": "test"}
Lambda Response: {"nivel": 1, "mensaje": "Nivel 1: Ok", ...}
Final Response: {"message": "Nivel 1: Ok"}
```

---

## **🎯 Características Clave del Sistema**

### **✅ Evaluación Retrospectiva**
- **Nunca evalúa datos parciales:** Solo minutos completos
- **Decisiones informadas:** Basadas en evidencia completa
- **Estabilidad:** Evita reacciones prematuras

### **✅ Recuperación Gradual**
- **Transiciones suaves:** 3→2→1 paso a paso
- **Prevención de oscilaciones:** No hay saltos bruscos
- **Adaptación progresiva:** Permite estabilización

### **✅ Persistencia Robusta**
- **Estado conservado:** Sobrevive entre invocaciones
- **Inicialización segura:** Valores por defecto apropiados
- **Limpieza automática:** Garbage collection de datos antiguos

### **✅ Fallbacks Seguros**
- **Manejo de errores:** En cada nivel del sistema
- **Respuestas garantizadas:** Siempre retorna algo válido
- **Degradación graceful:** Nunca falla completamente

### **✅ Observabilidad Completa**
- **Logging detallado:** Cada decisión es trazeable
- **Métricas de estado:** Información de debugging
- **Transparencia:** Proceso de evaluación visible

---

## **🚀 Ventajas del Diseño**

1. **🎯 Precisión Temporal:** Sin Math.floor, timestamps exactos
2. **🔄 Reactividad Apropiada:** Responde a tendencias, no a picos
3. **💾 Eficiencia:** Limpieza automática de datos antiguos
4. **🔒 Robustez:** Múltiples capas de fallback
5. **📊 Escalabilidad:** Diseño stateless con persistencia externa
6. **🔍 Debugging:** Logs completos y estructurados
7. **⚡ Performance:** Evaluaciones mínimas y eficientes

---

## **📈 Casos de Uso Ideales**

- **Sistemas de alta disponibilidad** que requieren degradación automática
- **APIs críticas** que necesitan mantener servicio bajo carga
- **Microservicios** que deben adaptarse a fallos en dependencias
- **Sistemas de comercio electrónico** durante picos de tráfico
- **Plataformas financieras** que requieren operación continua

---

*Este documento describe la implementación completa del orquestador resiliente, diseñado para mantener la disponibilidad del servicio mediante degradación progresiva y recuperación automática basada en el análisis retrospectivo de patrones de error.*
