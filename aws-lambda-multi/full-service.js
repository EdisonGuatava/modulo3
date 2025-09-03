exports.handler = async (event) => {
    try {
        console.log('Full Service - Procesando petición:', JSON.stringify(event, null, 2));
        
        const { body, errorCount, isError } = event;
        
        // En nivel completo, el comportamiento depende de si la petición es error o no
        let response;
        
        if (isError) {
            // Si la petición viene marcada como error
            response = {
                nivel: 1,
                mensaje: 'Nivel 1: Operación full con error',
                data: body,
                capabilities: ['transacciones', 'analisis', 'monitoreo', 'reportes'],
                errorCount: errorCount,
                timestamp: new Date().toISOString(),
                processedBy: 'FullServiceLambda',
                status: 'error'
            };
        } else {
            // Si la petición es exitosa, servicio completo normal
            response = {
                nivel: 1,
                mensaje: 'Nivel 1: Ok',
                data: body,
                capabilities: ['transacciones', 'analisis', 'monitoreo', 'reportes'],
                errorCount: errorCount,
                timestamp: new Date().toISOString(),
                processedBy: 'FullServiceLambda',
                status: 'full'
            };
        }
        
        
        console.log('Full Service - Respuesta generada:', JSON.stringify(response, null, 2));
        
        return response;
        
    } catch (error) {
        console.error('Error en Full Service:', error);
        return {
            nivel: 1,
            mensaje: 'Nivel 1: Operación full con error',
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
};
