
// Variáveis globais
let camera;
let websocket;
let isRunning = false;


// para detecção de objetos 
let detectedObjects = []; // <<== Será preenchido pelo WebSocket que recebe a IA - estou simulando por enquanto
let currentTarget = null; // <<== Será preenchido pelo WebSocket que recebe a IA - estou simulando por enquanto

// Para armazenar gestos
let registeredGestures = JSON.parse(localStorage.getItem('handGestures')) || [];
let isCapturingGesture = false;
let currentGestureData = null;
let captureFrames = [];
let captureCount = 0;
const CAPTURE_FRAMES_NEEDED = 5;

// Elementos da página
const videoElement = document.getElementById('inputVideo');
const canvasElement = document.getElementById('outputCanvas');
const canvasCtx = canvasElement.getContext('2d');
const gestureOutput = document.getElementById('gestureOutput');
const startBtn = document.getElementById('startBtn');
const connectBtn = document.getElementById('connectBtn');
const connectionStatus = document.getElementById('connectionStatus');
const captureBtn = document.getElementById('captureGesture');
const registerBtn = document.getElementById('registerGesture');
const objectNameInput = document.getElementById('objectName');
const gestureTypeSelect = document.getElementById('gestureType');
const statusMessage = document.getElementById('statusMessage');
const gesturesList = document.getElementById('gesturesList');
const clearGesturesBtn = document.getElementById('clearGestures');

// Configuração do MediaPipe Hands
const hands = new Hands({
    locateFile: (file) => {
        return `https://cdn.jsdelivr.net/npm/@mediapipe/hands/${file}`;
    }
});

hands.setOptions({
    maxNumHands: 1, // otimizado para 1 mão (2 - duas mãos)
    modelComplexity: 1, //modelo 1 mais preciso e mais pesado e modelo 0 um pouco mais leve e menos preciso
    minDetectionConfidence: 0.85, //pode ser ajustado para 0,8 ou mais caso a detecção fique instável com o modelo 0
    minTrackingConfidence: 0.85
});

hands.onResults(handleResults);

/*
// Função para processar os resultados
function handleResults(results) {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    
    // Desenhar a imagem da câmera
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);
    
    if (results.multiHandLandmarks) {
        for (const landmarks of results.multiHandLandmarks) {
            // Desenhar as conexões e pontos de referência da mão
            drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, {
                color: '#00FF00',
                lineWidth: 4
            });
            drawLandmarks(canvasCtx, landmarks, {
                color: '#FF0000',
                lineWidth: 2,
                radius: (data) => {
                    return lerp(data.from.z, -0.15, 0.1, 5, 1);
                }
            });
            
            // Reconhecer gestos
            const gesture = recognizeGesture(landmarks);
            if (gesture) {
                gestureOutput.textContent = `Gestos detectados: ${gesture}`;
                
                // Enviar via WebSocket se estiver conectado
                sendGesture(gesture);
            }
        }
    }
    canvasCtx.restore();
}
*/

//Início do bloco novo 
// Função Nova para processar os resultados
function handleResults(results) {
    canvasCtx.save();
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);

    // Desenhar a imagem da câmera
    canvasCtx.drawImage(results.image, 0, 0, canvasElement.width, canvasElement.height);

    if (results.multiHandLandmarks && results.multiHandLandmarks.length > 0) {
        const landmarks = results.multiHandLandmarks[0];

        // Desenhar as conexões e pontos de referência da mão
        drawConnectors(canvasCtx, landmarks, HAND_CONNECTIONS, {
            color: '#00FF00',
            lineWidth: 4
        });
        drawLandmarks(canvasCtx, landmarks, {
            color: '#FF0000',
            lineWidth: 2,
            radius: (data) => {
                return lerp(data.from.z, -0.15, 0.1, 5, 1);
            }
        });

        // Se estiver capturando gesto
        if (isCapturingGesture) {
            captureGestureFrame(landmarks);
        } else {
            // Reconhecer gestos cadastrados
            const recognizedGesture = recognizeRegisteredGesture(landmarks);
            if (recognizedGesture) {
                gestureOutput.textContent = `Gesto detectado: ${recognizedGesture.name} (${recognizedGesture.type})`;
                sendGesture(recognizedGesture);
            } else {
                // Reconhecer gestos padrão
                const standardGesture = recognizeStandardGesture(landmarks);
                if (standardGesture) {
                    gestureOutput.textContent = `Gesto padrão: ${standardGesture}`;
                    sendGesture({ name: standardGesture, type: 'standard' });
                }
            }
        }
    } else if (!isCapturingGesture) {
        gestureOutput.textContent = "Nenhuma mão detectada";
    }

    canvasCtx.restore();
}

// Função para capturar frames do gesto
function captureGestureFrame(landmarks) {
    captureFrames.push(normalizeHandLandmarks(landmarks));
    captureCount++;

    gestureOutput.textContent = `Capturando... ${captureCount}/${CAPTURE_FRAMES_NEEDED}`;

    if (captureCount >= CAPTURE_FRAMES_NEEDED) {
        finishCapture();
    }
}

// Função para finalizar a captura
function finishCapture() {
    isCapturingGesture = false;
    captureBtn.textContent = "Capturar Sinal";
    captureBtn.classList.remove('capturing');

    // Calcular gesto médio
    currentGestureData = calculateAverageGesture(captureFrames);

    gestureOutput.textContent = "Gesto capturado! Agora clique em 'Cadastrar Sinal'";
    registerBtn.disabled = false;

    showStatusMessage("Gesto capturado com sucesso! Preencha o nome e clique em cadastrar.", "success");

    // Limpar frames
    captureFrames = [];
    captureCount = 0;
}
//Fim do bloco novo

// Função para normalizar landmarks da mão
function normalizeHandLandmarks(landmarks) {
    // Encontrar o centro da mão (pulso)
    const wrist = landmarks[0];

    // Normalizar todos os pontos em relação ao pulso
    const normalized = landmarks.map(point => ({
        x: point.x - wrist.x,
        y: point.y - wrist.y,
        z: point.z - wrist.z
    }));

    return normalized;
}

// Função para calcular gesto médio
function calculateAverageGesture(frames) {
    const avgGesture = [];

    for (let i = 0; i < 21; i++) { // 21 pontos de referência da mão
        let sumX = 0, sumY = 0, sumZ = 0;

        frames.forEach(frame => {
            sumX += frame[i].x;
            sumY += frame[i].y;
            sumZ += frame[i].z;
        });

        avgGesture.push({
            x: sumX / frames.length,
            y: sumY / frames.length,
            z: sumZ / frames.length
        });
    }

    return avgGesture;
}

// Função para reconhecer gestos cadastrados
function recognizeRegisteredGesture(landmarks) {
    const normalizedLandmarks = normalizeHandLandmarks(landmarks);
    let bestMatch = null;
    let bestScore = Infinity;
    const threshold = 0.3; // Limiar de similaridade

    registeredGestures.forEach(gesture => {
        const score = calculateGestureSimilarity(normalizedLandmarks, gesture.landmarks);
        if (score < threshold && score < bestScore) {
            bestScore = score;
            bestMatch = gesture;
        }
    });

    return bestMatch;
}

// Função para calcular similaridade entre gestos
function calculateGestureSimilarity(landmarks1, landmarks2) {
    let totalDistance = 0;

    for (let i = 0; i < 21; i++) {
        const dist = Math.sqrt(
            Math.pow(landmarks1[i].x - landmarks2[i].x, 2) +
            Math.pow(landmarks1[i].y - landmarks2[i].y, 2) +
            Math.pow(landmarks1[i].z - landmarks2[i].z, 2)
        );
        totalDistance += dist;
    }

    return totalDistance / 21; // Média das distâncias
}

function recognizeGesture(landmarks) {
    // Primeiro verifica gestos padrão
    const standardGesture = recognizeStandardGesture(landmarks);
    if (standardGesture) return { type: 'standard', name: standardGesture };

    // Depois verifica gestos cadastrados
    return recognizeCustomGesture(landmarks);
}

// Função para reconhecer gestos específicos
function recognizeStandardGesture(landmarks) {
    // Pontos de referência
    const thumbTip = landmarks[4];
    const indexTip = landmarks[8];
    const middleTip = landmarks[12];
    const ringTip = landmarks[16];
    const pinkyTip = landmarks[20];
    const wrist = landmarks[0];

    // Calcular distâncias entre os dedos
    const thumbIndexDist = calculateDistance(thumbTip, indexTip);
    const indexMiddleDist = calculateDistance(indexTip, middleTip);
    const middleRingDist = calculateDistance(middleTip, ringTip);
    const ringPinkyDist = calculateDistance(ringTip, pinkyTip);

    // Verificar quais dedos estão estendidos
    const fingersExtended = {
        thumb: isFingerExtended(landmarks, 0),
        index: isFingerExtended(landmarks, 1),
        middle: isFingerExtended(landmarks, 2),
        ring: isFingerExtended(landmarks, 3),
        pinky: isFingerExtended(landmarks, 4)
    };

    // 1. Sinal de OK (polegar e indicador se tocando, outros fechados)
    if (thumbIndexDist < 0.03 &&
        !fingersExtended.middle &&
        !fingersExtended.ring &&
        !fingersExtended.pinky) {
        return "OK";
    }

    // 2. Sinal de paz (indicador e médio estendidos, outros dobrados)
    if (!fingersExtended.thumb &&
        fingersExtended.index &&
        fingersExtended.middle &&
        !fingersExtended.ring &&
        !fingersExtended.pinky) {
        return "PAZ";
    }

    // 3. Polegar para cima (apenas polegar estendido)
    if (fingersExtended.thumb &&
        !fingersExtended.index &&
        !fingersExtended.middle &&
        !fingersExtended.ring &&
        !fingersExtended.pinky) {
        return "POLEGAR LEVANTADO";
    }

    // 4. Punho fechado (todos os dedos dobrados)
    if (!fingersExtended.thumb &&
        !fingersExtended.index &&
        !fingersExtended.middle &&
        !fingersExtended.ring &&
        !fingersExtended.pinky) {
        return "PUNHO";
    }

    // 5. Mão aberta (todos os dedos estendidos)
    if (fingersExtended.thumb &&
        fingersExtended.index &&
        fingersExtended.middle &&
        fingersExtended.ring &&
        fingersExtended.pinky) {
        return "MAO ABERTA";
    }

    // 6. Sinal de Indicador 
    if (!fingersExtended.thumb &&
        fingersExtended.index &&
        !fingersExtended.middle &&
        !fingersExtended.ring &&
        !fingersExtended.pinky) {
        return "DEDO INDICADOR LEVANTADO";
    }

    // 7. Gesto de Garra  
    if (fingersExtended.thumb &&
        !fingersExtended.index &&
        !fingersExtended.middle &&
        !fingersExtended.ring &&
        fingersExtended.pinky) {
        return "HANG LOSE";
    }

    // 8. Sinal de Coração (ainda não funciona)
    if (thumbIndexDist < 0.08 &&
        !fingersExtended.middle &&
        !fingersExtended.ring &&
        !fingersExtended.pinky) {
        return "CORAÇÃO";
    }

    return null;
}

// Reconhece gestos customizados cadastrados
function recognizeCustomGesture(landmarks) {
    if (registeredGestures.length === 0) return null;

    // Para cada gesto cadastrado, calcular similaridade
    let bestMatch = null;
    let bestScore = 0;
    const threshold = 0.8;

    registeredGestures.forEach(gesture => {
        const score = compareGestures(gesture.gestureData, landmarks);
        if (score > bestScore && score > threshold) {
            bestScore = score;
            bestMatch = gesture;
        }
    });

    return bestMatch ? {
        type: 'custom',
        name: bestMatch.objectName,
        gestureType: bestMatch.gestureType,
        confidence: bestScore
    } : null;
}

// Compara dois gestos e retorna um score de similaridade
function compareGestures(gesture1, gesture2) {
    let totalDistance = 0;

    for (let i = 0; i < gesture1.length && i < gesture2.length; i++) {
        const dx = gesture1[i].x - gesture2[i].x;
        const dy = gesture1[i].y - gesture2[i].y;
        totalDistance += Math.sqrt(dx * dx + dy * dy);
    }

    // Normaliza o score (quanto menor a distância, maior a similaridade)
    const maxPossibleDistance = Math.sqrt(2) * gesture1.length;
    return 1 - (totalDistance / maxPossibleDistance);
}

// Função auxiliar para cálculo de distância (Linear Interpolation)
function lerp(value, inMin, inMax, outMin, outMax) {
    return outMin + (outMax - outMin) * ((value - inMin) / (inMax - inMin));
}

// Função para calcular distância entre dois pontos
function calculateDistance(point1, point2) {
    return Math.sqrt(
        Math.pow(point1.x - point2.x, 2) +
        Math.pow(point1.y - point2.y, 2)
    );
}

// Função para verificar se um dedo está estendido
function isFingerExtended(landmarks, fingerIndex) {
    // Pontos de referência para cada dedo
    const fingerPoints = [
        [0, 1, 2, 3, 4],       // Polegar
        [0, 5, 6, 7, 8],       // Indicador
        [0, 9, 10, 11, 12],    // Médio
        [0, 13, 14, 15, 16],    // Anelar
        [0, 17, 18, 19, 20]     // Mindinho
    ];

    const points = fingerPoints[fingerIndex];
    const tip = landmarks[points[4]];
    const dip = landmarks[points[3]];
    const pip = landmarks[points[2]];
    const mcp = landmarks[points[1]];

    // Para o polegar, usamos um cálculo diferente
    if (fingerIndex === 0) {
        const thumbDirection = {
            x: tip.x - pip.x,
            y: tip.y - pip.y
        };
        const handDirection = {
            x: mcp.x - landmarks[0].x,
            y: mcp.y - landmarks[0].y
        };

        // Produto escalar para determinar a direção
        const dotProduct = thumbDirection.x * handDirection.x + thumbDirection.y * handDirection.y;
        return dotProduct > 0; // Polegar está estendido se apontando para fora
    }

    // Para outros dedos: verificar se a ponta está acima da junta
    return tip.y < pip.y;
}

/* PARA A IA

// Processa o gesto detectado
function processDetectedGesture(gesture, landmarks) {
    let gestureText = '';
    
    if (gesture.type === 'custom') {
        gestureText = `Objeto: ${gesture.name} (${Math.round(gesture.confidence * 100)}%)`;
        playAudioFeedback(`Objeto ${gesture.name} detectado`);
        
        // Verificar se o objeto está na lista de objetos detectados
        const targetObject = detectedObjects.find(obj => obj.name === gesture.name);
        if (targetObject) {
            currentTarget = targetObject;
            guideUserToObject(landmarks, targetObject);
        } else {
            gestureOutput.textContent = `${gestureText} - Objeto não encontrado`;
            playAudioFeedback("Objeto não encontrado na cena");
        }
    } else {
        gestureText = `Gesto: ${gesture.name}`;
        playAudioFeedback(`Gesto ${gesture.name} detectado`);
    }
    
    gestureOutput.textContent = gestureText;
    sendGesture(gesture);
}

// Guia o usuário até o objeto
function guideUserToObject(handLandmarks, targetObject) {
    // Centro da mão (aproximadamente)
    const handCenter = {
        x: handLandmarks[0].x * canvasElement.width,
        y: handLandmarks[0].y * canvasElement.height
    };
    
    // Centro do objeto alvo
    const targetCenter = {
        x: (targetObject.x + targetObject.width / 2) * canvasElement.width,
        y: (targetObject.y + targetObject.height / 2) * canvasElement.height
    };
    
    // Calcular direção
    const dx = targetCenter.x - handCenter.x;
    const dy = targetCenter.y - handCenter.y;
    const distance = Math.sqrt(dx * dx + dy * dy);
    
    // Determinar orientação
    let direction = '';
    if (Math.abs(dx) > Math.abs(dy)) {
        direction = dx > 0 ? 'direita' : 'esquerda';
    } else {
        direction = dy > 0 ? 'abaixo' : 'acima';
    }
    
    // Feedback para o usuário
    if (distance < 50) {
        gestureOutput.textContent = `Objeto ${targetObject.name} encontrado!`;
        playAudioFeedback(`Objeto ${targetObject.name} encontrado`);
    } else {
        gestureOutput.textContent = `Mova a mão para ${direction} para alcançar ${targetObject.name}`;
        playAudioFeedback(`Mova para ${direction}`);
    }
    
    // Desenhar linha de guia
    canvasCtx.beginPath();
    canvasCtx.moveTo(handCenter.x, handCenter.y);
    canvasCtx.lineTo(targetCenter.x, targetCenter.y);
    canvasCtx.strokeStyle = 'rgba(0, 255, 255, 0.7)';
    canvasCtx.lineWidth = 3;
    canvasCtx.stroke();
    
    // Desenhar círculo no alvo
    canvasCtx.beginPath();
    canvasCtx.arc(targetCenter.x, targetCenter.y, 20, 0, 2 * Math.PI);
    canvasCtx.fillStyle = 'rgba(0, 255, 255, 0.3)';
    canvasCtx.fill();
}
*/


// Função para enviar gesto via WebSocket
function sendGesture(gesture) {
    if (websocket && websocket.readyState === WebSocket.OPEN) {
        const message = {
            type: "gesture",
            gesture: gesture,
            timestamp: new Date().toISOString()
        };
        websocket.send(JSON.stringify(message));
    }
}

//fim bloco novo
// Funções de interface
function showStatusMessage(message, type) {
    statusMessage.textContent = message;
    statusMessage.className = `status-message ${type}`;

    setTimeout(() => {
        statusMessage.textContent = "";
        statusMessage.className = "";
    }, 5000);
}

function updateGesturesList() {
    if (registeredGestures.length === 0) {
        gesturesList.innerHTML = "<p>Nenhum gesto cadastrado ainda.</p>";
        return;
    }

    const html = registeredGestures.map((gesture, index) => `
                <div class="gesture-item">
                    <div class="gesture-info">
                        <div class="gesture-name">${gesture.name}</div>
                        <div class="gesture-type">Tipo: ${gesture.type}</div>
                    </div>
                    <button class="btn btn-danger" onclick="removeGesture(${index})">Remover</button>
                </div>
            `).join('');

    gesturesList.innerHTML = html;
}

function removeGesture(index) {
    registeredGestures.splice(index, 1);
    localStorage.setItem('handGestures', JSON.stringify(registeredGestures));
    updateGesturesList();
    showStatusMessage("Gesto removido com sucesso!", "success");
}

//fim bloco novo
// Configuração da câmera
function startCamera() {
    if (isRunning) return;

    camera = new Camera(videoElement, {
        onFrame: async () => {
            await hands.send({ image: videoElement });
        },
        width: 320,
        height: 240
    });
    camera.start();
    isRunning = true;
    startBtn.textContent = "Parar";
    playAudioFeedback("Câmera iniciada");

}

function stopCamera() {
    if (!isRunning) return;

    if (camera) {
        camera.stop();
    }
    isRunning = false;
    startBtn.textContent = "Iniciar";

    // Limpar o canvas
    canvasCtx.clearRect(0, 0, canvasElement.width, canvasElement.height);
    gestureOutput.textContent = "Aguardando detecção...";
    playAudioFeedback("Câmera parada");

}
//câmera do celular (Precisa do HTTPS para funcionar)
const constraints = {
    audio: false,
    video: {
        facingMode: { ideal: "environment" } // Use "environment" para traseira e "user" para frontal
    }
};

navigator.mediaDevices.getUserMedia(constraints)
    .then((stream) => {
        videoElement.srcObject = stream;
        videoElement.play();
    })
    .catch((error) => {
        console.error("Erro ao acessar a câmera:", error);
        alert("Não foi possível acessar a câmera. Verifique as permissões.");
    });
//câmera do celular

// Configuração do WebSocket
function connectWebSocket() {
    if (websocket && (websocket.readyState === WebSocket.OPEN || websocket.readyState === WebSocket.CONNECTING)) {
        websocket.close();
        return;
    }

    websocket = new WebSocket('wss://websocket-image-recognition.onrender.com');

    websocket.onopen = () => {
        console.log("Conectado ao servidor WebSocket");
        connectionStatus.textContent = "Conectado";
        connectionStatus.className = "connection-status connected";
        connectBtn.textContent = "Desconectar";
    };

    websocket.onclose = () => {
        console.log("Desconectado do servidor WebSocket");
        connectionStatus.textContent = "Desconectado";
        connectionStatus.className = "connection-status disconnected";
        connectBtn.textContent = "Conectar WebSocket";
    };

    websocket.onerror = (error) => {
        console.error("Erro no WebSocket:", error);
        connectionStatus.textContent = "Erro de conexão";
        connectionStatus.className = "connection-status disconnected";
    };

    //Para Recolher a mensagem da IA 
    websocket.onmessage = function (event) {
        console.log("Mensagem recebida:", event.data);
        // <<== NOVO: Aqui você poderia receber os dados da IA de objetos
        // try {
        //    const data = JSON.parse(event.data);
        //    if (data.type === 'objectDetection') {
        //       detectedObjects = data.objects; // Atualiza a lista de objetos
        //    }
        // } catch (e) { console.error("Erro ao processar msg:", e); }
    };

    websocket.onmessage = function (event) {
        console.log("Mensagem recebida:", event.data);
        try {
            const data = JSON.parse(event.data);
            if (data.type === 'objectDetection') {
                detectedObjects = data.objects;
                playAudioFeedback(`${data.objects.length} objetos detectados`);
            }
        } catch (e) {
            console.error("Erro ao processar mensagem:", e);
        }
    };
}

// Para acessibilidade - feedback por áudio
function playAudioFeedback(message) {
    if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(message);
        utterance.lang = 'pt-BR';
        speechSynthesis.speak(utterance);
    }
}

// Event Listeners
startBtn.addEventListener('click', () => {
    if (isRunning) {
        stopCamera();
    } else {
        startCamera();
    }
});

connectBtn.addEventListener('click', connectWebSocket());

//Início do Bloco novo 
captureBtn.addEventListener('click', () => {
    if (!isRunning) {
        showStatusMessage("Inicie a câmera primeiro!", "error");
        return;
    }

    if (isCapturingGesture) {
        // Cancelar captura
        isCapturingGesture = false;
        captureBtn.textContent = "Capturar Sinal";
        captureBtn.classList.remove('capturing');
        captureFrames = [];
        captureCount = 0;
        gestureOutput.textContent = "Captura cancelada";
        showStatusMessage("Captura cancelada.", "warning");
    } else {
        // Iniciar captura
        isCapturingGesture = true;
        captureBtn.textContent = "Cancelar Captura";
        captureBtn.classList.add('capturing');
        captureFrames = [];
        captureCount = 0;
        currentGestureData = null;
        registerBtn.disabled = true;
        showStatusMessage("Mantenha o gesto estável por alguns segundos...", "warning");
    }
});

registerBtn.addEventListener('click', () => {
    const objectName = objectNameInput.value.trim();
    const gestureType = gestureTypeSelect.value;

    if (!objectName) {
        showStatusMessage("Por favor, preencha o nome do objeto!", "error");
        return;
    }

    if (!currentGestureData) {
        showStatusMessage("Capture um gesto primeiro!", "error");
        return;
    }

    // Verificar se já existe um gesto com o mesmo nome
    const existingGesture = registeredGestures.find(g => g.name.toLowerCase() === objectName.toLowerCase());
    if (existingGesture) {
        if (!confirm("Já existe um gesto com este nome. Deseja substituí-lo?")) {
            return;
        }
        // Remover o gesto existente
        const index = registeredGestures.indexOf(existingGesture);
        registeredGestures.splice(index, 1);
    }

    // Criar novo gesto
    const newGesture = {
        id: Date.now(),
        name: objectName,
        type: gestureType,
        landmarks: currentGestureData,
        createdAt: new Date().toISOString()
    };

    registeredGestures.push(newGesture);
    localStorage.setItem('handGestures', JSON.stringify(registeredGestures));

    // Limpar formulário
    objectNameInput.value = '';
    gestureTypeSelect.value = 'point';
    currentGestureData = null;
    registerBtn.disabled = true;

    updateGesturesList();
    showStatusMessage(`Gesto "${objectName}" cadastrado com sucesso!`, "success");
});

clearGesturesBtn.addEventListener('click', () => {
    if (registeredGestures.length === 0) {
        showStatusMessage("Não há gestos para remover.", "warning");
        return;
    }

    if (confirm("Tem certeza que deseja remover todos os gestos cadastrados?")) {
        registeredGestures = [];
        localStorage.removeItem('handGestures');
        updateGesturesList();
        showStatusMessage("Todos os gestos foram removidos.", "success");
    }
});

// Inicializar interface
updateGesturesList();

