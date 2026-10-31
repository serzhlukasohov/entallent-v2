import { Injectable } from '@nestjs/common';
import { BuildPulseReportUseCase } from '@entalent/application';
import { isPulseAssemblyError, type BuildPulseReportRequest } from '@entalent/contracts';
import { renderPulseReportForSlack } from '@entalent/channel-slack';
import { PulseReportPresentationRepository } from './repositories/pulse-report-presentation.repository';
/** Explicit read/build API only; deliberately has no processor/scheduler/sender. */
@Injectable()
export class PulseReportSlackAssemblyService {
  constructor(
    private readonly build: BuildPulseReportUseCase,
    private readonly repository: PulseReportPresentationRepository,
  ) {}
  async assemble(input: BuildPulseReportRequest) {
    const built = await this.build.execute(input);
    if (built.status !== 'built') return built;
    try {
      const slack = renderPulseReportForSlack(built.presentation);
      if (!(await this.repository.validate(built.provenance.context, built.provenance.sections)))
        return { status: 'invalidated' as const };
      return { ...built, slack };
    } catch (error) {
      return { status: isPulseAssemblyError(error) ? error.code : ('blocked' as const) };
    }
  }
}
