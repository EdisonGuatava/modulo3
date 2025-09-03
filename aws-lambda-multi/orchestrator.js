const AWS = require('aws-sdk');
const dynamo = new AWS.DynamoDB.DocumentClient();
const lambda = new AWS.Lambda();

const SYSTEM_ID = 'main';
const TABLE_NAME = process.env.DYNAMODB_TABLE || 'SystemState';

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
        
        const date = new Date(currentTime);
        const currentMinute = date.getTime() - (date.getTime() % 60000); // Minuto exacto en timestamp
        const previousMinute = currentMinute - 60000; // Exactamente 1 minuto atrás
        
        // Para debug: mostrar tiempo real
        console.log(`Tiempo real: ${date.toISOString()}, Current minute timestamp: ${currentMinute}, Previous minute timestamp: ${previousMinute}`);
        
        // Leer estado actual del sistema
        const state = await getSystemState();
        let { errorsByMinute = {}, currentLevel = 1, lastCheckedMinute = currentMinute - 60000 } = state;
        
        // Registrar error si viene marcado como error en el minuto actual
        if (isError) {
            if (!errorsByMinute[currentMinute]) {
                errorsByMinute[currentMinute] = 0;
            }
            errorsByMinute[currentMinute]++;
            console.log(`Error registrado en timestamp ${currentMinute}. Total errores en este minuto: ${errorsByMinute[currentMinute]}`);
        }
        
        // Determinar nivel de servicio basado en errores del minuto anterior
        let level = currentLevel;
        const previousLevel = level;
        
        // Solo recalcular nivel si cambiamos de minuto timestamp
        if (currentMinute > lastCheckedMinute) {
            const errorsInPreviousMinute = errorsByMinute[previousMinute] || 0;
            console.log(`=== CAMBIO DE MINUTO ===`);
            console.log(`Minuto anterior (timestamp ${previousMinute}): ${errorsInPreviousMinute} errores`);
            console.log(`Nivel actual: ${currentLevel}`);
            
            // Lógica de transición basada en errores del minuto anterior
            if (errorsInPreviousMinute >= 10) {
                level = 3;
            } else if (errorsInPreviousMinute >= 5) {
                level = 2;
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
            
            // Log de transición si cambia el nivel
            if (level !== previousLevel) {
                console.log(`🔄 TRANSICIÓN: Nivel ${previousLevel} → ${level}. Errores minuto anterior: ${errorsInPreviousMinute}`);
            } else {
                console.log(`⏸️ SIN CAMBIO: Nivel ${level}. Errores minuto anterior: ${errorsInPreviousMinute}`);
            }
            
            lastCheckedMinute = currentMinute;
        } else {
            console.log(`⏰ Mismo minuto timestamp ${currentMinute}, manteniendo nivel ${level}`);
        }
        
        // Limpiar errores de minutos muy antiguos (mantener solo últimos 10 minutos)
        const cutoffTimestamp = currentMinute - (10 * 60000); // 10 minutos atrás
        Object.keys(errorsByMinute).forEach(timestamp => {
            if (parseInt(timestamp) < cutoffTimestamp) {
                delete errorsByMinute[timestamp];
            }
        });
        
        // Guardar nuevo estado
        await saveSystemState(errorsByMinute, level, lastCheckedMinute);
        
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
        
        console.log(`Orchestrator - Respuesta nivel ${level}:`, JSON.stringify(response, null, 2));
        
        return {
            statusCode: 200,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify(response)
        };
        
    } catch (error) {
        console.error('Error en Orchestrator:', error);
        return {
            statusCode: 500,
            headers: {
                'Content-Type': 'application/json',
                'Access-Control-Allow-Origin': '*'
            },
            body: JSON.stringify({
                message: "Nivel 3: Sistema bajo mantenimiento, intente más tarde"
            })
        };
    }
};

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
