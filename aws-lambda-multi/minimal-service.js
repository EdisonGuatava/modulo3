exports.handler = async (event) => {
    try {
        console.log('Minimal Service - Procesando petición:', JSON.stringify(event, null, 2));
        
        const { body, errorCount, isError } = event;
        
        // En nivel mínimo, el comportamiento depende de si la petición es error o no
        let response;
        
        if (isError) {
            // Si la petición viene marcada como error, respondemos con mantenimiento
            response = {
                nivel: 3,
                mensaje: 'Nivel 3: Sistema bajo mantenimiento, intente más tarde',
                data: body,
                errorCount: errorCount,
                timestamp: new Date().toISOString(),
                processedBy: 'MinimalServiceLambda',
                status: 'maintenance'
            };
        } else {
            // Si la petición es exitosa, operación al mínimo
            response = {
                nivel: 3,
                mensaje: 'Nivel 3: Operación al mínimo',
                data: body,
                capabilities: ['solo-monitoreo'],
                errorCount: errorCount,
                timestamp: new Date().toISOString(),
                processedBy: 'MinimalServiceLambda',
                status: 'minimal'
            };
        }
        
        // Simular tiempo de procesamiento mínimo
        await new Promise(resolve => setTimeout(resolve, 10));
        
        console.log('Minimal Service - Respuesta generada:', JSON.stringify(response, null, 2));
        
        return response;
        
    } catch (error) {
        console.error('Error en Minimal Service:', error);
        return {
            nivel: 3,
            mensaje: 'Nivel 3: Sistema bajo mantenimiento, intente más tarde',
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
};
