import './style.css';
import { browserStorage } from './persist/FrameStore';
import { PeriodEditor } from './periods/PeriodEditor';
import { PeriodStore } from './periods/PeriodStore';

const back = document.getElementById('back-to-clock') as HTMLAnchorElement;
back.href = './clock.html' + location.search;
new PeriodEditor(document, new PeriodStore(browserStorage()));
