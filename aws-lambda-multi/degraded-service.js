exports.handler = async (event) => {
    try {
        console.log('Degraded Service - Procesando petición:', JSON.stringify(event, null, 2));
        
        const { body, errorCount } = event;
        
        // Servicio degradado: solo funcionalidades esenciales
        const response = {
            nivel: 2,
            mensaje: 'Nivel 2: Servicio degradado - Funcionalidades esenciales activas',
            data: body,
            capabilities: ['transacciones', 'monitoreo'], // Solo lo esencial
            errorCount: errorCount,
            timestamp: new Date().toISOString(),
            processedBy: 'DegradedServiceLambda',
            warning: 'Algunas funcionalidades no disponibles temporalmente'
        };
        
        // Simular tiempo de procesamiento reducido
        await new Promise(resolve => setTimeout(resolve, 50));
        
        console.log('Degraded Service - Respuesta generada:', JSON.stringify(response, null, 2));
        
        return response;
        
    } catch (error) {
        console.error('Error en Degraded Service:', error);
        return {
            nivel: 2,
            mensaje: 'Error en servicio degradado',
            error: error.message,
            timestamp: new Date().toISOString()
        };
    }
};
