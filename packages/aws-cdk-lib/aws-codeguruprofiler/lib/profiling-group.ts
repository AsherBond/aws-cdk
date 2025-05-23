import { Construct } from 'constructs';
import { CfnProfilingGroup } from './codeguruprofiler.generated';
import { Grant, IGrantable } from '../../aws-iam';
import { ArnFormat, IResource, Lazy, Names, Resource, Stack } from '../../core';
import { addConstructMetadata } from '../../core/lib/metadata-resource';
import { propertyInjectable } from '../../core/lib/prop-injectable';

/**
 * The compute platform of the profiling group.
 */
export enum ComputePlatform {
  /**
   * Use AWS_LAMBDA if your application runs on AWS Lambda.
   */
  AWS_LAMBDA = 'AWSLambda',

  /**
   * Use Default if your application runs on a compute platform that is not AWS Lambda,
   * such an Amazon EC2 instance, an on-premises server, or a different platform.
   */
  DEFAULT = 'Default',
}

/**
 * IResource represents a Profiling Group.
 */
export interface IProfilingGroup extends IResource {

  /**
   * The name of the profiling group.
   *
   * @attribute
   */
  readonly profilingGroupName: string;

  /**
   * The ARN of the profiling group.
   *
   * @attribute
   */
  readonly profilingGroupArn: string;

  /**
   * Grant access to publish profiling information to the Profiling Group to the given identity.
   *
   * This will grant the following permissions:
   *
   *  - codeguru-profiler:ConfigureAgent
   *  - codeguru-profiler:PostAgentProfile
   *
   * @param grantee Principal to grant publish rights to
   */
  grantPublish(grantee: IGrantable): Grant;

  /**
   * Grant access to read profiling information from the Profiling Group to the given identity.
   *
   * This will grant the following permissions:
   *
   *  - codeguru-profiler:GetProfile
   *  - codeguru-profiler:DescribeProfilingGroup
   *
   * @param grantee Principal to grant read rights to
   */
  grantRead(grantee: IGrantable): Grant;

}

abstract class ProfilingGroupBase extends Resource implements IProfilingGroup {
  public abstract readonly profilingGroupName: string;

  public abstract readonly profilingGroupArn: string;

  /**
   * Grant access to publish profiling information to the Profiling Group to the given identity.
   *
   * This will grant the following permissions:
   *
   *  - codeguru-profiler:ConfigureAgent
   *  - codeguru-profiler:PostAgentProfile
   *
   * @param grantee Principal to grant publish rights to
   */
  public grantPublish(grantee: IGrantable) {
    // https://docs.aws.amazon.com/codeguru/latest/profiler-ug/security-iam.html#security-iam-access-control
    return Grant.addToPrincipal({
      grantee,
      actions: ['codeguru-profiler:ConfigureAgent', 'codeguru-profiler:PostAgentProfile'],
      resourceArns: [this.profilingGroupArn],
    });
  }

  /**
   * Grant access to read profiling information from the Profiling Group to the given identity.
   *
   * This will grant the following permissions:
   *
   *  - codeguru-profiler:GetProfile
   *  - codeguru-profiler:DescribeProfilingGroup
   *
   * @param grantee Principal to grant read rights to
   */
  public grantRead(grantee: IGrantable) {
    // https://docs.aws.amazon.com/codeguru/latest/profiler-ug/security-iam.html#security-iam-access-control
    return Grant.addToPrincipal({
      grantee,
      actions: ['codeguru-profiler:GetProfile', 'codeguru-profiler:DescribeProfilingGroup'],
      resourceArns: [this.profilingGroupArn],
    });
  }
}

/**
 * Properties for creating a new Profiling Group.
 */
export interface ProfilingGroupProps {

  /**
   * A name for the profiling group.
   * @default - automatically generated name.
   */
  readonly profilingGroupName?: string;

  /**
   * The compute platform of the profiling group.
   *
   * @default ComputePlatform.DEFAULT
   */
  readonly computePlatform?: ComputePlatform;

}

/**
 * A new Profiling Group.
 */
@propertyInjectable
export class ProfilingGroup extends ProfilingGroupBase {
  /** Uniquely identifies this class. */
  public static readonly PROPERTY_INJECTION_ID: string = 'aws-cdk-lib.aws-codeguruprofiler.ProfilingGroup';

  /**
   * Import an existing Profiling Group provided a Profiling Group Name.
   *
   * @param scope The parent creating construct
   * @param id The construct's name
   * @param profilingGroupName Profiling Group Name
   */
  public static fromProfilingGroupName(scope: Construct, id: string, profilingGroupName: string): IProfilingGroup {
    const stack = Stack.of(scope);

    return this.fromProfilingGroupArn(scope, id, stack.formatArn({
      service: 'codeguru-profiler',
      resource: 'profilingGroup',
      resourceName: profilingGroupName,
    }));
  }

  /**
   * Import an existing Profiling Group provided an ARN.
   *
   * @param scope The parent creating construct
   * @param id The construct's name
   * @param profilingGroupArn Profiling Group ARN
   */
  public static fromProfilingGroupArn(scope: Construct, id: string, profilingGroupArn: string): IProfilingGroup {
    class Import extends ProfilingGroupBase {
      public readonly profilingGroupName = Stack.of(scope).splitArn(profilingGroupArn, ArnFormat.SLASH_RESOURCE_NAME).resourceName!;
      public readonly profilingGroupArn = profilingGroupArn;
    }

    return new Import(scope, id, {
      environmentFromArn: profilingGroupArn,
    });
  }

  /**
   * The name of the Profiling Group.
   *
   * @attribute
   */
  public readonly profilingGroupName: string;

  /**
   * The ARN of the Profiling Group.
   *
   * @attribute
   */
  public readonly profilingGroupArn: string;

  constructor(scope: Construct, id: string, props: ProfilingGroupProps = {}) {
    super(scope, id, {
      physicalName: props.profilingGroupName ?? Lazy.string({ produce: () => this.generateUniqueId() }),
    });
    // Enhanced CDK Analytics Telemetry
    addConstructMetadata(this, props);

    const profilingGroup = new CfnProfilingGroup(this, 'ProfilingGroup', {
      profilingGroupName: this.physicalName,
      computePlatform: props.computePlatform,
    });

    this.profilingGroupName = this.getResourceNameAttribute(profilingGroup.ref);

    this.profilingGroupArn = this.getResourceArnAttribute(profilingGroup.attrArn, {
      service: 'codeguru-profiler',
      resource: 'profilingGroup',
      resourceName: this.physicalName,
    });
  }

  private generateUniqueId(): string {
    const name = Names.uniqueId(this);
    if (name.length > 240) {
      return name.substring(0, 120) + name.substring(name.length - 120);
    }
    return name;
  }
}
