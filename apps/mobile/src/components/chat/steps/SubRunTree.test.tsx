import { SUB_RUN_STOPPED_BY_USER, type SubRunTask } from '@rerun/contracts'
import mobileSteps from '@rerun/i18n/messages/en/mobileSteps.json'
import { render, screen } from '@testing-library/react-native'
import { IntlProvider } from 'use-intl'

import { SubRunTree } from '@/components/chat/steps/SubRunTree'

const task = (title: string, status: SubRunTask['status'], error?: string): SubRunTask => ({ id: title, title, status, steps: 0, error })

async function show(tasks: SubRunTask[]) {
    await render(
        <IntlProvider locale="en" messages={{ mobileSteps } as never} onError={() => {}} getMessageFallback={({ key }) => key}>
            <SubRunTree tasks={tasks} />
        </IntlProvider>,
    )
}

describe('SubRunTree', () => {
    it('says the work is kept only for a task stopped by hand', async () => {
        await show([task('By hand', 'stopped', SUB_RUN_STOPPED_BY_USER), task('With the run', 'stopped', 'stopped along with the calling run'), task('Cut here', 'stopped')])
        expect(screen.getAllByText('Stopped, partial work kept')).toHaveLength(1)
        expect(screen.getAllByText('Stopped with the run')).toHaveLength(2)
        expect(screen.queryByText(/calling run/)).toBeNull()
    })

    it('keeps the reason of a task that failed', async () => {
        await show([task('Broken', 'error', 'provider 500')])
        expect(screen.getByText('provider 500')).toBeTruthy()
    })
})
