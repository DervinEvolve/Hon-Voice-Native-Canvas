import { Stage } from '../../kit'
import './capture.css'

// Show the complete supplied app capture. No rebuilt controls, transcript,
// extra window chrome or illustrative conversation panel.
export default function HonReadme() {
 return <Stage width={1080} height={510} className='hon-real-capture' theme='dark'>
  {()=> <img src='/readme-captures/hon-image.png' alt='Actual Hon canvas during a speech-to-speech session'/>}
 </Stage>
}
