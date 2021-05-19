/* global AudioContext:false, Event:false, Worker:false, MediaRecorder:false, fetch:false, URL:false */

const audioContext = new AudioContext()
const devicesSelect = document.querySelector('#devices')
const sharpsRadio = document.querySelector('#sharps')
const listenButton = document.querySelector('#listen')
const pitchText = document.querySelector('#pitch')
const frequencyText = document.querySelector('#frequency')
const targetFrequencyText = document.querySelector('#targetFrequency')
const centsText = document.querySelector('#cents')

/** @type {Worker} */
let audioProcessor
/** @type {number} */
let refreshHandle
/** @type {MediaRecorder} */
let mediaRecorder
/** @type {MediaStream} */
let sourceStream
/** @type {boolean} */
let listening

// Runs whenever a different audio input device is selected by the user.
devicesSelect.addEventListener('change', async event => {
  if (event.target.value) {
    if (listening) {
      stop()
    }

    // Retrieve the MediaStream for the selected audio input device.
    sourceStream = await navigator.mediaDevices.getUserMedia({
      audio: {
        deviceId: {
          exact: event.target.value
        }
      }
    })

    // Enable the listen button if we have obtained a MediaStream.
    listenButton.disabled = !sourceStream
  }
})

// Add each available audio input device to the `<select>` element.
navigator.mediaDevices.enumerateDevices().then(devices => {
  const fragment = document.createDocumentFragment()
  for (const device of devices) {
    if (device.kind === 'audioinput') {
      const option = document.createElement('option')
      option.textContent = device.label
      option.value = device.deviceId
      fragment.append(option)
    }
  }

  devicesSelect.append(fragment)

  // Run the event listener on the `<select>` element after the input devices
  // have been populated. This way the listen button won't remain disabled at
  // start.
  devicesSelect.dispatchEvent(new Event('change'))
})

// Runs when the user clicks the listen button.
listenButton.addEventListener('click', () => {
  if (listening) {
    stop()
  } else {
    listen()
  }
})

/**
 * Starts listening for audio.
 */
function listen () {
  listening = true
  audioProcessor = new Worker('audio-processor.js')
  audioProcessor.addEventListener('message', handleProcessorMessage)
  listenButton.textContent = 'Stop listening'
  mediaRecorder = new MediaRecorder(sourceStream)

  mediaRecorder.ondataavailable = update
  mediaRecorder.start()
  setTimeout(() => listening && mediaRecorder.stop(), 500)

  // Every 500ms, send whatever has been recorded to the audio processor.
  // This can't be done with `mediaRecorder.start(ms)` because the
  // `AudioContext` may fail to decode the audio data when sent in parts.
  refreshHandle = setInterval(() => {
    listening && mediaRecorder.start()
    setTimeout(() => listening && mediaRecorder.stop(), 500)
  }, 1000)
}

/**
 * Stops listening for audio.
 */
function stop () {
  listening = false
  clearInterval(refreshHandle)
  audioProcessor.terminate()
  audioProcessor = null
  mediaRecorder.stop()
  listenButton.textContent = 'Listen'
  pitchText.textContent = ''
  frequencyText.textContent = ''
  targetFrequencyText.textContent = ''
  centsText.textContent = ''
}

/**
 * Handles data received from a `MediaRecorder`.
 * @param {BlobEvent} event Blob event from the `MediaRecorder`.
 */
async function update (event) {
  if (event.data.size > 0) {
    await process(event.data)
  }
}

/**
 * Sends audio data to the audio processing worker.
 * @param {Blob} data The blob containing the recorded audio data.
 */
async function process (data) {
  // Load the blob.
  const response = await fetch(URL.createObjectURL(data))
  const arrayBuffer = await response.arrayBuffer()
  // Decode the audio.
  const audioBuffer = await audioContext.decodeAudioData(arrayBuffer)
  const audioData = audioBuffer.getChannelData(0)
  // Send the audio data to the audio processing worker.
  audioProcessor.postMessage({
    a4: Number(document.querySelector('#a4').value),
    sampleRate: audioBuffer.sampleRate,
    audioData,
    accidentals: sharpsRadio.checked ? 'sharps' : 'flats'
  })
}

/**
 * Handles responses received from the audio processing web worker.
 * @param {MessageEvent} event The message from the audio processing web worker.
 */
function handleProcessorMessage (event) {
  if (listening) {
    if (event.data) {
      pitchText.textContent = event.data.key + event.data.octave.toString()
      frequencyText.textContent = event.data.frequency.toFixed(2) + 'Hz'
      targetFrequencyText.textContent = event.data.correctHz.toFixed(2) + 'Hz'
      centsText.textContent = Math.abs(event.data.centsOff).toFixed(2) +
        (event.data.centsOff > 0 ? ' sharp' : ' flat')
    } else {
      pitchText.textContent = 'Unknown'
      frequencyText.textContent = ''
      targetFrequencyText.textContent = ''
      centsText.textContent = ''
    }
  }
}
