import { Construct } from 'constructs';
import { CidrSplit, calculateCidrSplits } from './cidr-splits';
import { CfnVPCCidrBlock } from './ec2.generated';
import { NetworkBuilder } from './network-util';
import { SubnetConfiguration } from './vpc';
import { Fn, Token, UnscopedValidationError } from '../../core';

/**
 * An abstract Provider of IpAddresses
 *
 * Note this is specific to the IPv4 CIDR.
 */
export class IpAddresses {
  /**
   * Used to provide local Ip Address Management services for your VPC
   *
   * VPC CIDR is supplied at creation and subnets are calculated locally
   *
   * Note this is specific to the IPv4 CIDR.
   *
   */
  public static cidr(cidrBlock: string): IIpAddresses {
    return new Cidr(cidrBlock);
  }

  /**
   * Used to provide centralized Ip Address Management services for your VPC
   *
   * Uses VPC CIDR allocations from AWS IPAM
   *
   * Note this is specific to the IPv4 CIDR.
   *
   * @see https://docs.aws.amazon.com/vpc/latest/ipam/what-it-is-ipam.html
   */
  public static awsIpamAllocation(props: AwsIpamProps): IIpAddresses {
    return new AwsIpam(props);
  }

  private constructor() { }
}

/**
 * Implementations for ip address management.
 *
 * Note this is specific to the IPv4 CIDR.
 */
export interface IIpAddresses {
  /**
   * Called by the VPC to retrieve VPC options from the Ipam
   *
   * Don't call this directly, the VPC will call it automatically.
   */
  allocateVpcCidr(): VpcIpamOptions;

  /**
   * Called by the VPC to retrieve Subnet options from the Ipam
   *
   * Don't call this directly, the VPC will call it automatically.
   */
  allocateSubnetsCidr(input: AllocateCidrRequest): SubnetIpamOptions;
}

/**
 * CIDR Allocated Vpc
 */
export interface VpcIpamOptions {

  /**
   * CIDR Block for Vpc
   *
   * @default - Only required when Ipam has concrete allocation available for static Vpc
   */
  readonly cidrBlock?: string;

  /**
   * CIDR Mask for Vpc
   *
   * @default - Only required when using AWS Ipam
   */
  readonly ipv4NetmaskLength?: number;

  /**
   * ipv4 IPAM Pool Id
   *
   * @default - Only required when using AWS Ipam
   */
  readonly ipv4IpamPoolId?: string;
}

/**
 * Subnet requested for allocation
 */
export interface RequestedSubnet {

  /**
   * The availability zone for the subnet
   */
  readonly availabilityZone: string;

  /**
   * Specify configuration parameters for a single subnet group in a VPC
   */
  readonly configuration: SubnetConfiguration;

  /**
   * Id for the Subnet construct
   */
  readonly subnetConstructId: string;
}

/**
 * An instance of a Subnet requested for allocation
 */
interface IRequestedSubnetInstance {
  /**
   * Index location of Subnet requested for allocation
   */
  readonly index: number;

  /**
   * Subnet requested for allocation
   */
  readonly requestedSubnet: RequestedSubnet;
}

/**
 * Request for subnets CIDR to be allocated for a Vpc
 */
export interface AllocateCidrRequest {
  /**
   * The IPv4 CIDR block for this Vpc
   */
  readonly vpcCidr: string;

  /**
   * The Subnets to be allocated
   */
  readonly requestedSubnets: RequestedSubnet[];
}

/**
 * Request for allocation of the VPC IPv6 CIDR.
 */
export interface AllocateVpcIpv6CidrRequest {
  /**
   * The VPC construct to attach to.
   */
  readonly scope: Construct;

  /**
   * The id of the VPC.
   */
  readonly vpcId: string;
}

/**
 * Request for IPv6 CIDR block to be split up.
 */
export interface CreateIpv6CidrBlocksRequest {
  /**
   * The IPv6 CIDR block string representation.
   */
  readonly ipv6SelectedCidr: string;

  /**
   * The number of subnets to assign CIDRs to.
   */
  readonly subnetCount: number;

  /**
   * Size of the covered bits in the CIDR.
   * @default - 128 - 64 = /64 CIDR.
   */
  readonly sizeMask?: string;
}

/**
 * Request for subnet IPv6 CIDRs to be allocated for a VPC.
 */
export interface AllocateIpv6CidrRequest {
  /**
   * List of subnets allocated with IPv4 CIDRs
   */
  readonly allocatedSubnets: AllocatedSubnet[];

  /**
   * The IPv6 CIDRs to be allocated to the subnets
   */
  readonly ipv6Cidrs: string[];
}

/**
 * CIDR Allocated Subnets
 */
export interface SubnetIpamOptions {
  /**
   * CIDR Allocations for Subnets
   */
  readonly allocatedSubnets: AllocatedSubnet[];
}

/**
 * CIDR Allocated Subnet
 */
export interface AllocatedSubnet {
  /**
   * IPv4 CIDR Allocations for a Subnet.
   *
   * Note this is specific to the IPv4 CIDR.
   */
  readonly cidr: string;

  /**
   * IPv6 CIDR Allocations for a Subnet.
   *
   * Note this is specific to the IPv6 CIDR.
   *
   * @default - no IPV6 CIDR
   */
  readonly ipv6Cidr?: string;
}

/**
 * Configuration for AwsIpam
 */
export interface AwsIpamProps {

  /**
   * Netmask length for Vpc
   */
  readonly ipv4NetmaskLength: number;

  /**
   * Ipam Pool Id for ipv4 allocation
   */
  readonly ipv4IpamPoolId: string; // todo: should be a type

  /**
   * Default length for Subnet ipv4 Network mask
   *
   * Specify this option only if you do not specify all Subnets using SubnetConfiguration with a cidrMask
   *
   * @default - Default ipv4 Subnet Mask for subnets in Vpc
   *
   */
  readonly defaultSubnetIpv4NetmaskLength?: number;
}

/**
 * Implements integration with Amazon VPC IP Address Manager (IPAM).
 *
 * See the package-level documentation of this package for an overview
 * of the various dimensions in which you can configure your VPC.
 *
 * For example:
 *
 * ```ts
 *  new ec2.Vpc(stack, 'TheVPC', {
 *   ipAddresses: IpAddresses.awsIpamAllocation({
 *     ipv4IpamPoolId: pool.ref,
 *     ipv4NetmaskLength: 18,
 *     defaultSubnetIpv4NetmaskLength: 24
 *   })
 * });
 * ```
 *
 */
class AwsIpam implements IIpAddresses {
  constructor(private readonly props: AwsIpamProps) {
  }

  /**
   * Allocates Vpc CIDR. called when creating a Vpc using AwsIpam.
   */
  allocateVpcCidr(): VpcIpamOptions {
    return {
      ipv4NetmaskLength: this.props.ipv4NetmaskLength,
      ipv4IpamPoolId: this.props.ipv4IpamPoolId,
    };
  }

  /**
   * Allocates Subnets CIDRs. Called by VPC when creating subnets.
   */
  allocateSubnetsCidr(input: AllocateCidrRequest): SubnetIpamOptions {
    const cidrSplit = calculateCidrSplits(this.props.ipv4NetmaskLength, input.requestedSubnets.map((mask => {
      if ((mask.configuration.cidrMask === undefined) && (this.props.defaultSubnetIpv4NetmaskLength=== undefined) ) {
        throw new UnscopedValidationError('If you have not set a cidr for all subnets in this case you must set a defaultCidrMask in AwsIpam Options');
      }

      const cidrMask = mask.configuration.cidrMask ?? this.props.defaultSubnetIpv4NetmaskLength;

      if (cidrMask === undefined) {
        throw new UnscopedValidationError('Should not have happened, but satisfies the type checker');
      }

      return cidrMask;
    })));

    const allocatedSubnets: AllocatedSubnet[] = cidrSplit.map(subnet => {
      return {
        cidr: cidrSplitToCfnExpression(input.vpcCidr, subnet),
      };
    });

    return {
      allocatedSubnets: allocatedSubnets,
    };
  }
}

/**
 * Convert a CIDR split command to a CFN expression that calculates the same CIDR
 *
 * Can recursively produce multiple `{ Fn::Cidr }` expressions.
 *
 * This is necessary because CFN's `{ Fn::Cidr }` reifies the split to an actual list of
 * strings, and to limit resource consumption `count` may never be higher than 256. So
 * if we need to split deeper, we need to do more than one split.
 *
 * (Function public for testing)
 */
export function cidrSplitToCfnExpression(parentCidr: string, split: CidrSplit) {
  const MAX_COUNT = 256;
  const MAX_COUNT_BITS = 8;

  if (split.count === 1) {
    return parentCidr;
  }

  if (split.count <= MAX_COUNT) {
    return Fn.select(split.index, Fn.cidr(parentCidr, split.count, `${32-split.netmask}`));
  }

  if (split.netmask - MAX_COUNT_BITS < 1) {
    throw new UnscopedValidationError(`Cannot split an IP range into ${split.count} /${split.netmask}s`);
  }

  const parentSplit = {
    netmask: split.netmask - MAX_COUNT_BITS,
    count: Math.ceil(split.count / MAX_COUNT),
    index: Math.floor(split.index / MAX_COUNT),
  };
  return cidrSplitToCfnExpression(cidrSplitToCfnExpression(parentCidr, parentSplit), {
    netmask: split.netmask,
    count: MAX_COUNT,
    index: split.index - (parentSplit.index * MAX_COUNT),
  });
}

/**
 * Implements static Ip assignment locally.
 *
 * See the package-level documentation of this package for an overview
 * of the various dimensions in which you can configure your VPC.
 *
 * For example:
 *
 * ```ts
 *  new ec2.Vpc(stack, 'TheVPC', {
 *   ipAddresses: ec2.IpAddresses.cidr('10.0.1.0/20')
 * });
 * ```
 *
 */
class Cidr implements IIpAddresses {
  private readonly networkBuilder: NetworkBuilder;

  constructor(private readonly cidrBlock: string) {
    if (Token.isUnresolved(cidrBlock)) {
      throw new UnscopedValidationError('\'cidr\' property must be a concrete CIDR string, got a Token (we need to parse it for automatic subdivision)');
    }

    this.networkBuilder = new NetworkBuilder(this.cidrBlock);
  }

  /**
   * Allocates Vpc CIDR. Called when creating a Vpc using IpAddresses.cidr.
   */
  allocateVpcCidr(): VpcIpamOptions {
    return {
      cidrBlock: this.networkBuilder.networkCidr.cidr,
    };
  }

  /**
   * Allocates Subnets Cidrs. Called by VPC when creating subnets.
   */
  allocateSubnetsCidr(input: AllocateCidrRequest): SubnetIpamOptions {
    const allocatedSubnets: AllocatedSubnet[] = [];
    const subnetsWithoutDefinedCidr: IRequestedSubnetInstance[] = [];
    // default: Available IP space is evenly divided across subnets if no cidr is given.

    input.requestedSubnets.forEach((requestedSubnet, index) => {
      if (requestedSubnet.configuration.cidrMask === undefined) {
        subnetsWithoutDefinedCidr.push({
          index,
          requestedSubnet,
        });
      } else {
        allocatedSubnets.push({
          cidr: this.networkBuilder.addSubnet(requestedSubnet.configuration.cidrMask),
        });
      }
    });

    const cidrMaskForRemaining = this.networkBuilder.maskForRemainingSubnets(subnetsWithoutDefinedCidr.length);
    subnetsWithoutDefinedCidr.forEach((subnet)=> {
      allocatedSubnets.splice(subnet.index, 0, {
        cidr: this.networkBuilder.addSubnet(cidrMaskForRemaining),
      });
    });

    return {
      allocatedSubnets: allocatedSubnets,
    };
  }
}

/**
 * An abstract Provider of Ipv6Addresses.
 *
 * Note this is specific to the IPv6 CIDR.
 */
export class Ipv6Addresses {
  /**
   * Used for IPv6 address management with Amazon provided CIDRs.
   *
   * Note this is specific to the IPv6 CIDR.
   */
  public static amazonProvided(): IIpv6Addresses {
    return new AmazonProvided();
  }

  private constructor() { }
}

/**
 * Implementations for IPv6 address management.
 *
 * Note this is specific to the IPv6 CIDR.
 */
export interface IIpv6Addresses {
  /**
   * Whether the IPv6 CIDR is Amazon provided or not.
   *
   * Note this is specific to the IPv6 CIDR.
   */
  amazonProvided: boolean;

  /**
   * Called by VPC to allocate IPv6 CIDR.
   *
   * Note this is specific to the IPv6 CIDR.
   */
  allocateVpcIpv6Cidr(input: AllocateVpcIpv6CidrRequest): CfnVPCCidrBlock;

  /**
   * Split IPv6 CIDR block up for subnets.
   *
   * Note this is specific to the IPv6 CIDR.
   */
  createIpv6CidrBlocks(input: CreateIpv6CidrBlocksRequest): string[];

  /**
   * Allocates Subnets IPv6 CIDRs. Called by VPC when creating subnets with IPv6 enabled.
   *
   * Note this is specific to the IPv6 CIDR.
   */
  allocateSubnetsIpv6Cidr(input: AllocateIpv6CidrRequest): SubnetIpamOptions;
}

/**
 * Implements integration with Amazon provided IPv6 CIDRs.
 *
 * Note this is specific to the IPv6 CIDR.
 */
class AmazonProvided implements IIpv6Addresses {
  /**
   * Whether the IPv6 CIDR is Amazon provided or not.
   */
  amazonProvided: boolean;

  constructor() {
    this.amazonProvided = true;
  }
  /**
   * Called by VPC to allocate IPv6 CIDR.
   *
   * Creates an Amazon provided CIDR block.
   *
   * Note this is specific to the IPv6 CIDR.
   */
  allocateVpcIpv6Cidr(input: AllocateVpcIpv6CidrRequest): CfnVPCCidrBlock {
    // throw new Error(`vpcId not found, got ${(scope as any).vpcId}`);
    return new CfnVPCCidrBlock(input.scope, 'ipv6cidr', {
      vpcId: input.vpcId,
      amazonProvidedIpv6CidrBlock: this.amazonProvided,
    });
  }

  /**
   * Split IPv6 CIDR block up for subnets.
   *
   * Called by VPC when creating subnets with IPv6 enabled.
   *
   * Note this is specific to the IPv6 CIDR.
   */
  createIpv6CidrBlocks(input: CreateIpv6CidrBlocksRequest): string[] {
    const sizeMask = input.sizeMask ?? '64'; // 128 - 64

    return Fn.cidr(input.ipv6SelectedCidr, input.subnetCount, sizeMask);
  }

  /**
   * Allocates Subnets IPv6 CIDRs. Called by VPC when creating subnets with IPv6 enabled.
   *
   * This function takes the list of allocated subnets,
   * and copies the IPv4 CIDRs while also assigning the IPv6 CIDR.
   *
   * Note this is specific to the IPv6 CIDR.
   */
  allocateSubnetsIpv6Cidr(input: AllocateIpv6CidrRequest): SubnetIpamOptions {
    const allocatedSubnets: AllocatedSubnet[] = [];

    input.allocatedSubnets.forEach((allocated, i) => {
      const allocatedIpv6: AllocatedSubnet = {
        cidr: allocated.cidr,
        ipv6Cidr: Fn.select(i, input.ipv6Cidrs),
      };
      allocatedSubnets.push(allocatedIpv6);
    });

    return {
      allocatedSubnets: allocatedSubnets,
    };
  }
}
