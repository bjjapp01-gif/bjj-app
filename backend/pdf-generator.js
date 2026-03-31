// pdf-generator.js
const htmlPdf = require('html-pdf-node');

// Opciones del PDF
const pdfOptions = {
    format: 'A4',
    margin: {
        top: '20px',
        bottom: '20px',
        left: '20px',
        right: '20px'
    },
    printBackground: true,
    preferCSSPageSize: true
};

// Generar PDF desde HTML
async function generatePDF(htmlContent) {
    try {
        const file = { content: htmlContent };
        const pdfBuffer = await htmlPdf.generatePdf(file, pdfOptions);
        return pdfBuffer;
    } catch (error) {
        console.error('Error generando PDF:', error);
        throw error;
    }
}

module.exports = { generatePDF };