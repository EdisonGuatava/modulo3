exports.handler = async (event) => {
    try {
        console.log('Degraded Service - Procesando petición:', JSON.stringify(event, null, 2));
        
        const { body, errorCount, isError } = event;
        
        // En nivel degradado, el comportamiento depende de si la petición es error o no
        let response;
        
        if (isError) {
            // Si la petición viene marcada como error, operación limitada
            response = {
                nivel: 2,
                mensaje: 'Nivel 2: Operación límitada',
                data: body,
                capabilities: ['transacciones-basicas', 'monitoreo'],
                errorCount: errorCount,
                timestamp: new Date().toISOString(),
                processedBy: 'DegradedServiceLambda',
                status: 'limited'
            };
        } else {
            // Si la petición es exitosa, servicio degradado normal
            response = {
                nivel: 2,
                mensaje: 'Nivel 2: Ok',
                data: body,
                capabilities: ['transacciones-basicas', 'monitoreo'],
                errorCount: errorCount,
                timestamp: new Date().toISOString(),
                processedBy: 'DegradedServiceLambda',
                status: 'degraded'
            };
        }
        
        
        console.log('Degraded Service - Respuesta generada:', JSON.stringify(response, null, 2));
        
        return response;
        
    } catch (error) {
        console.error('Error en Degraded Service:', error);
        return {
            nivel: 2,
            mensaje: 'Nivel 2: Operación límitada',
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
};
