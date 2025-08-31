exports.handler = async (event) => {
    try {
        console.log('Full Service - Procesando petición:', JSON.stringify(event, null, 2));
        
        const { body, errorCount } = event;
        
        // Simular procesamiento completo con todas las capacidades
        const response = {
            nivel: 1,
            mensaje: 'Nivel 1: Servicio completo - Todas las funcionalidades disponibles',
            data: body,
            capabilities: ['transacciones', 'analisis', 'monitoreo', 'reportes'],
            errorCount: errorCount,
            timestamp: new Date().toISOString(),
            processedBy: 'FullServiceLambda'
        };
        
        // Simular tiempo de procesamiento completo
        await new Promise(resolve => setTimeout(resolve, 100));
        
        console.log('Full Service - Respuesta generada:', JSON.stringify(response, null, 2));
        
        return response;
        
    } catch (error) {
        console.error('Error en Full Service:', error);
        return {
            nivel: 1,
            mensaje: 'Error en servicio completo',
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
};
