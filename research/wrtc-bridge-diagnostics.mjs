import wrtc from '../server/node_modules/wrtc/lib/index.js';

const { RTCPeerConnection } = wrtc;
const peer = new RTCPeerConnection({
  iceServers: [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun.cloudflare.com:3478'] }],
  iceCandidatePoolSize: 4,
});
const candidates = [];
const states = [];
const started = Date.now();
const waitForGathering = new Promise((resolve) => {
  const timer = setTimeout(resolve, 15000);
  peer.onicegatheringstatechange = () => {
    states.push({ atMs: Date.now() - started, state: peer.iceGatheringState });
    if (peer.iceGatheringState === 'complete') {
      clearTimeout(timer);
      resolve();
    }
  };
});
peer.onicecandidate = ({ candidate }) => {
  if (!candidate) return;
  const line = candidate.candidate || '';
  const match = /(?:^|\s)typ\s+(host|srflx|prflx|relay)(?:\s|$)/.exec(line);
  candidates.push({ type: match?.[1] || 'unknown', candidate: line, sdpMid: candidate.sdpMid, sdpMLineIndex: candidate.sdpMLineIndex });
};
peer.createDataChannel('fileTransfer');
const offer = await peer.createOffer();
await peer.setLocalDescription(offer);
await waitForGathering;
const sdpLines = (peer.localDescription?.sdp || '').split('\n').filter((line) => line.startsWith('a=candidate:'));
console.log(JSON.stringify({
  iceGatheringState: peer.iceGatheringState,
  iceConnectionState: peer.iceConnectionState,
  connectionState: peer.connectionState,
  candidateCount: candidates.length,
  candidateTypes: [...new Set(candidates.map((item) => item.type))],
  candidates,
  sdpCandidateCount: sdpLines.length,
  sdpCandidateTypes: [...new Set(sdpLines.map((line) => /(?:^|\s)typ\s+(host|srflx|prflx|relay)(?:\s|$)/.exec(line)?.[1] || 'unknown'))],
  gatheringStates: states,
}));
peer.close();
