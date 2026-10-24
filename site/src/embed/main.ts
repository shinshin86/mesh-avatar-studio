import '../../../packages/element/src/index';
import { DEFAULT_SRC } from '../../../packages/element/src/attributes';
import '../style.css';
import './style.css';
import { copy } from '../messages';
import { setupPlayground } from './playground.js';

setupPlayground(document.querySelector('#embed-playground')!, { sampleURL: DEFAULT_SRC, messages: copy });
